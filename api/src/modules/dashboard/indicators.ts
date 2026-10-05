/**
 * @project FabriHub - API
 * @file src/modules/dashboard/indicators.ts
 * @description Indicadores (DSH_INDICATORS): KPIs de inventario, calidad, producción, compras, ventas y planificación
 *
 * @overview
 * Cada bloque se calcula SOLO si el usuario puede ver su módulo de origen y con el mismo alcance que
 * tendría en esa pantalla: almacenes asignados en inventario y órdenes propias en ventas, salvo `view_all`.
 * Los montos van en la moneda base (documento × tasa de cambio). Las series son de los últimos 6 meses.
 *
 * Definiciones (para la defensa):
 *  - Rotación anualizada = costo de las salidas de 90 días × 365/90 ÷ valor actual del inventario.
 *  - Cobertura (días)    = valor del inventario ÷ costo promedio diario de las salidas de 90 días.
 *  - Cumplimiento        = documentos terminados a tiempo ÷ documentos terminados (180 días).
 *  - Variación de costo  = (real − estándar de lo fabricado) ÷ estándar de lo fabricado, OP cerradas (180 días).
 */

import { one, query } from "../../db.js";
import { handler } from "../../lib/http.js";
import { authOf } from "../../security/context.js";
import { type ModuleAccess, canView, moduleAccess, ownerScopeOf, warehouseScopeOf } from "./access.js";

const MONTHS = `generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS m(month)`;
const rate = (ok: number, total: number) => (total > 0 ? ok / total : null);

async function inventory(scope: string[] | null) {
  const [head, byType, flow] = await Promise.all([
    one<{ value: number; products: number; below_min: number }>(
      `SELECT COALESCE(SUM(v.total_value), 0)::float AS value,
              COUNT(DISTINCT v.product_id) FILTER (WHERE v.quantity > 0)::int AS products,
              (SELECT COUNT(*) FROM v_stock_alerts a WHERE a.kind = 'below_min' AND ($1::uuid[] IS NULL OR a.warehouse_id = ANY($1)))::int AS below_min
         FROM stock_valuation v WHERE $1::uuid[] IS NULL OR v.warehouse_id = ANY($1)`,
      [scope]
    ),
    query<{ type: string; value: number }>(
      `SELECT t.name AS type, SUM(v.total_value)::float AS value
         FROM stock_valuation v JOIN products p ON p.id = v.product_id JOIN catalogs_product_types t ON t.id = p.product_type_id
        WHERE v.quantity > 0 AND ($1::uuid[] IS NULL OR v.warehouse_id = ANY($1))
        GROUP BY t.name, t.order_list ORDER BY t.order_list`,
      [scope]
    ),
    one<{ out_cost: number }>(
      `SELECT COALESCE(SUM(m.total_cost), 0)::float AS out_cost FROM inventory_movements m
        WHERE m.direction = 'out' AND m.status = 'posted' AND m.reversal_of_id IS NULL
          AND m.movement_date > CURRENT_DATE - 90 AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1))`,
      [scope]
    )
  ]);
  // Lotes con existencia en los almacenes del alcance
  const lots = await one<{ expiring: number; expired: number; quarantine: number }>(
    `SELECT COUNT(*) FILTER (WHERE l.expires_on >= CURRENT_DATE AND l.expires_on <= CURRENT_DATE + COALESCE((fn_parameter('INVENTORY', 'expiry_alert_days'))::text::int, 90))::int AS expiring,
            COUNT(*) FILTER (WHERE l.expires_on < CURRENT_DATE)::int AS expired,
            COUNT(*) FILTER (WHERE l.quality_status = 'quarantine')::int AS quarantine
       FROM lots l
      WHERE l.quality_status <> 'rejected'
        AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.lot_id = l.id AND b.quantity > 0 AND ($1::uuid[] IS NULL OR b.warehouse_id = ANY($1)))`,
    [scope]
  );
  const value = head?.value ?? 0;
  const dailyOut = (flow?.out_cost ?? 0) / 90;
  return {
    totalValue: value,
    productsWithStock: head?.products ?? 0,
    belowMin: head?.below_min ?? 0,
    expiringLots: lots?.expiring ?? 0,
    expiredLots: lots?.expired ?? 0,
    quarantineLots: lots?.quarantine ?? 0,
    outflowCost90: flow?.out_cost ?? 0,
    turnover: value > 0 ? (dailyOut * 365) / value : null,
    coverageDays: dailyOut > 0 ? value / dailyOut : null,
    valueByType: byType,
    restricted: scope !== null
  };
}

async function quality() {
  const row = await one<{ quarantine: number; approved: number; rejected: number; avg_days: number | null }>(
    `SELECT (SELECT COUNT(*) FROM lots l WHERE l.quality_status = 'quarantine'
               AND EXISTS (SELECT 1 FROM stock_balances b WHERE b.lot_id = l.id AND b.quantity > 0))::int AS quarantine,
            COUNT(*) FILTER (WHERE e.to_status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE e.to_status = 'rejected')::int AS rejected,
            AVG(EXTRACT(EPOCH FROM e.decided_at - COALESCE(l.received_on, l.manufactured_on, l.created_at::date)::timestamptz) / 86400)
              FILTER (WHERE e.to_status = 'approved')::float AS avg_days
       FROM lots_quality_events e JOIN lots l ON l.id = e.lot_id
      WHERE e.from_status = 'quarantine' AND e.decided_at > NOW() - INTERVAL '90 days'`
  );
  const approved = row?.approved ?? 0;
  const rejected = row?.rejected ?? 0;
  return {
    quarantine: row?.quarantine ?? 0,
    approved90: approved,
    rejected90: rejected,
    approvalRate: rate(approved, approved + rejected),
    avgReleaseDays: row?.avg_days ?? null
  };
}

async function production() {
  const [byStatus, perf, monthly] = await Promise.all([
    query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM production_orders WHERE status NOT IN ('closed', 'cancelled') GROUP BY status`
    ),
    one<{ late: number; done: number; on_time: number; variance_pct: number | null }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('created', 'released', 'in_process') AND COALESCE(planned_end, planned_start) < CURRENT_DATE)::int AS late,
              COUNT(*) FILTER (WHERE confirmed_at > NOW() - INTERVAL '180 days')::int AS done,
              COUNT(*) FILTER (WHERE confirmed_at > NOW() - INTERVAL '180 days'
                                 AND confirmed_at::date <= COALESCE(planned_end, planned_start))::int AS on_time,
              (SUM(variance) FILTER (WHERE status = 'closed' AND closed_at > NOW() - INTERVAL '180 days')
                / NULLIF(SUM((std_material_cost + std_labor_cost + std_overhead_cost) * quantity_produced / quantity_planned)
                           FILTER (WHERE status = 'closed' AND closed_at > NOW() - INTERVAL '180 days'), 0))::float AS variance_pct
         FROM production_orders`
    ),
    query<{ month: string; orders: number; produced: number }>(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, COUNT(o.id)::int AS orders, COALESCE(SUM(o.quantity_produced), 0)::float AS produced
         FROM ${MONTHS}
         LEFT JOIN production_orders o ON o.confirmed_at IS NOT NULL AND date_trunc('month', o.confirmed_at) = m.month AND o.status IN ('confirmed', 'closed')
        GROUP BY m.month ORDER BY m.month`
    )
  ]);
  return {
    open: byStatus.reduce((s, r) => s + r.count, 0),
    late: perf?.late ?? 0,
    byStatus,
    onTimeRate: rate(perf?.on_time ?? 0, perf?.done ?? 0),
    variancePct: perf?.variance_pct ?? null,
    monthly
  };
}

async function purchases() {
  const [head, otd, monthly, top] = await Promise.all([
    one<{ open: number; pending_approval: number; open_amount: number }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('approved', 'partially_received'))::int AS open,
              COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
              COALESCE(SUM(total * exchange_rate) FILTER (WHERE status IN ('approved', 'partially_received')), 0)::float AS open_amount
         FROM purchase_orders`
    ),
    one<{ total: number; on_time: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE po.expected_date IS NULL OR r.reception_date <= po.expected_date)::int AS on_time
         FROM receptions r JOIN purchase_orders po ON po.id = r.purchase_order_id
        WHERE r.kind = 'receipt' AND r.status = 'posted' AND r.reception_date > CURRENT_DATE - 180`
    ),
    query<{ month: string; amount: number; orders: number }>(
      `SELECT to_char(m.month, 'YYYY-MM') AS month, COALESCE(SUM(po.total * po.exchange_rate), 0)::float AS amount, COUNT(po.id)::int AS orders
         FROM ${MONTHS}
         LEFT JOIN purchase_orders po ON date_trunc('month', po.order_date) = m.month
               AND po.status IN ('approved', 'partially_received', 'received', 'closed')
        GROUP BY m.month ORDER BY m.month`
    ),
    query<{ supplier: string; amount: number }>(
      `SELECT COALESCE(s.trade_name, s.legal_name) AS supplier, SUM(po.total * po.exchange_rate)::float AS amount
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status IN ('approved', 'partially_received', 'received', 'closed') AND po.order_date > CURRENT_DATE - 180
        GROUP BY s.id ORDER BY amount DESC LIMIT 5`
    )
  ]);
  const overdue = await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM purchase_orders po
      WHERE po.status IN ('approved', 'partially_received')
        AND (SELECT COALESCE(MIN(d.expected_date), po.expected_date) FROM purchase_orders_details d
              WHERE d.purchase_order_id = po.id AND d.quantity_received < d.quantity) < CURRENT_DATE`
  );
  return {
    open: head?.open ?? 0,
    pendingApproval: head?.pending_approval ?? 0,
    overdue: overdue?.n ?? 0,
    openAmount: head?.open_amount ?? 0,
    supplierOnTimeRate: rate(otd?.on_time ?? 0, otd?.total ?? 0),
    monthly,
    topSuppliers: top
  };
}

async function sales(owner: string | null) {
  const [head, otd, monthly, top] = await Promise.all([
    one<{ open: number; late: number; backorder_lines: number; open_amount: number }>(
      `SELECT COUNT(*) FILTER (WHERE so.status IN ('confirmed', 'partially_delivered'))::int AS open,
              COUNT(*) FILTER (WHERE so.status IN ('confirmed', 'partially_delivered') AND so.requested_date < CURRENT_DATE)::int AS late,
              COALESCE(SUM(so.total * so.exchange_rate) FILTER (WHERE so.status IN ('confirmed', 'partially_delivered')), 0)::float AS open_amount,
              (SELECT COUNT(*) FROM sales_orders_details d JOIN sales_orders o ON o.id = d.sales_order_id
                WHERE o.status IN ('confirmed', 'partially_delivered') AND d.quantity_delivered < d.quantity
                  AND ($1::uuid IS NULL OR o.created_by = $1))::int AS backorder_lines
         FROM sales_orders so WHERE $1::uuid IS NULL OR so.created_by = $1`,
      [owner]
    ),
    one<{ total: number; on_time: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE x.last_delivery <= so.requested_date)::int AS on_time
         FROM sales_orders so
         CROSS JOIN LATERAL (SELECT MAX(n.delivery_date) AS last_delivery FROM delivery_notes n
                              WHERE n.sales_order_id = so.id AND n.status = 'posted') x
        WHERE so.status IN ('delivered', 'closed') AND so.requested_date IS NOT NULL AND x.last_delivery IS NOT NULL
          AND so.order_date > CURRENT_DATE - 180 AND ($1::uuid IS NULL OR so.created_by = $1)`,
      [owner]
    ),
    query<{ month: string; sales: number; cost: number; margin: number }>(
      `SELECT to_char(m.month, 'YYYY-MM') AS month,
              COALESCE(SUM(n.net_amount * so.exchange_rate), 0)::float AS sales,
              COALESCE(SUM(n.cost_amount), 0)::float AS cost,
              COALESCE(SUM(n.net_amount * so.exchange_rate - n.cost_amount), 0)::float AS margin
         FROM ${MONTHS}
         LEFT JOIN (delivery_notes n JOIN sales_orders so ON so.id = n.sales_order_id AND ($1::uuid IS NULL OR so.created_by = $1))
                ON n.status = 'posted' AND date_trunc('month', n.delivery_date) = m.month
        GROUP BY m.month ORDER BY m.month`,
      [owner]
    ),
    query<{ code: string; name: string; amount: number; quantity: number }>(
      `SELECT p.code, p.name, SUM(d.quantity * d.unit_price * so.exchange_rate)::float AS amount, SUM(d.stock_quantity)::float AS quantity
         FROM delivery_notes_details d
         JOIN delivery_notes n ON n.id = d.delivery_note_id
         JOIN sales_orders so ON so.id = n.sales_order_id
         JOIN products p ON p.id = d.product_id
        WHERE n.status = 'posted' AND n.delivery_date > CURRENT_DATE - 90 AND ($1::uuid IS NULL OR so.created_by = $1)
        GROUP BY p.id ORDER BY amount DESC LIMIT 5`,
      [owner]
    )
  ]);
  return {
    open: head?.open ?? 0,
    late: head?.late ?? 0,
    openAmount: head?.open_amount ?? 0,
    backorderLines: head?.backorder_lines ?? 0,
    onTimeRate: rate(otd?.on_time ?? 0, otd?.total ?? 0),
    monthly,
    topProducts: top,
    restricted: owner !== null
  };
}

async function planning() {
  const row = await one<{ run_at: string | null; period: string | null; make: number; buy: number; late: number }>(
    `WITH last AS (SELECT r.id, r.run_at, p.name FROM mrp_runs r JOIN planning_periods p ON p.id = r.period_id ORDER BY r.run_at DESC LIMIT 1)
     SELECT (SELECT run_at FROM last) AS run_at, (SELECT name FROM last) AS period,
            COUNT(*) FILTER (WHERE s.kind = 'make')::int AS make, COUNT(*) FILTER (WHERE s.kind = 'buy')::int AS buy,
            COUNT(*) FILTER (WHERE s.is_late)::int AS late
       FROM mrp_suggestions s WHERE s.run_id = (SELECT id FROM last) AND s.status = 'open'`
  );
  return {
    lastRunAt: row?.run_at ?? null,
    period: row?.period ?? null,
    openSuggestions: { make: row?.make ?? 0, buy: row?.buy ?? 0, late: row?.late ?? 0 }
  };
}

export async function indicatorsFor(userId: string, access: ModuleAccess) {
  const currency = await one<{ code: string; symbol: string | null }>(
    `SELECT c.code, c.symbol FROM company co JOIN catalogs_currencies c ON c.id = co.base_currency_id LIMIT 1`
  );
  const [inv, qc, prd, pur, sal, pln] = await Promise.all([
    canView(access, "INV_STOCK") ? inventory(warehouseScopeOf(access, "INV_STOCK")) : null,
    canView(access, "QC_LOTS") ? quality() : null,
    canView(access, "PRD_ORDERS") ? production() : null,
    canView(access, "PUR_ORDERS") ? purchases() : null,
    canView(access, "SAL_ORDERS") ? sales(ownerScopeOf(access, "SAL_ORDERS", userId)) : null,
    canView(access, "PRD_PLANNING") ? planning() : null
  ]);
  return {
    generatedAt: new Date().toISOString(),
    currency: currency ?? { code: "", symbol: null },
    inventory: inv,
    quality: qc,
    production: prd,
    purchases: pur,
    sales: sal,
    planning: pln
  };
}

export const getIndicators = handler({}, async ({ req }) => {
  const userId = authOf(req).userId;
  return indicatorsFor(userId, await moduleAccess(userId));
});
