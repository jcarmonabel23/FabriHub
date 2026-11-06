/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/inventory.ts
 * @description Reportes de inventario para decidir: reposición sugerida, riesgo de quiebre y
 * productos sin movimiento
 *
 * @overview
 * Trabajan por almacén y producto (alcance: almacenes asignados sin view_all de INV_STOCK).
 * El RANGO es la ventana de consumo: salidas contabilizadas (ventas, despachos, consumos de
 * producción, ajustes; sin traslados ni reversos) divididas entre sus días dan el consumo diario.
 * «En camino» suma lo pendiente de OC aprobadas y de OP abiertas hacia ese almacén.
 *
 * Reposición: punto de pedido = máx(mínimo de la política, consumo diario × plazo de entrega);
 * objetivo = máximo de la política o, sin él, consumo de (plazo + 15) días y nunca menos que el
 * mínimo. Se sugiere reponer cuando disponible + en camino ≤ punto de pedido.
 */

import { query } from "../../../db.js";
import { warehouseScopeOf } from "../access.js";
import { type Ctx, type ReportDef, type Row, daysIn, groupSum, ratio, shiftIso, sum, sumUsd } from "./types.js";

/** Plazo de entrega si el producto no tiene uno */
const DEFAULT_LEAD_DAYS = 7;
/** Días de cobertura adicionales al plazo para el objetivo sin máximo */
const SAFETY_DAYS = 15;
/** Cobertura bajo la cual un producto entra en «riesgo de quiebre» */
const RISK_DAYS = 14;

interface Position {
  warehouse: string;
  productCode: string;
  productName: string;
  family: string | null;
  unit: string;
  decimals: number;
  isPurchased: boolean;
  isManufactured: boolean;
  leadDays: number | null;
  quantity: number;
  available: number;
  minQty: number | null;
  maxQty: number | null;
  outQty: number;
  onOrder: number;
  nextArrival: string | null;
  avgCost: number;
  lastOut: string | null;
  lastIn: string | null;
  usd: number | null;
}

/** Posición de cada producto inventariable activo en cada almacén del alcance */
async function positions(ctx: Ctx): Promise<Position[]> {
  return query<Position>(
    `WITH bal AS (
       SELECT b.warehouse_id, b.product_id, SUM(b.quantity) AS qty, SUM(b.quantity - b.reserved) AS avail
         FROM stock_balances b GROUP BY 1, 2
     ), mov AS (
       SELECT m.warehouse_id, d.product_id,
              SUM(d.quantity) FILTER (WHERE m.direction = 'out' AND m.movement_date BETWEEN $2 AND $3) AS out_qty,
              MAX(m.movement_date) FILTER (WHERE m.direction = 'out') AS last_out,
              MAX(m.movement_date) FILTER (WHERE m.direction = 'in') AS last_in
         FROM inventory_movements_details d JOIN inventory_movements m ON m.id = d.movement_id
        WHERE m.status = 'posted' AND m.reversal_of_id IS NULL AND m.direction IN ('in', 'out') AND m.movement_date <= $3
        GROUP BY 1, 2
     ), incoming AS (
       SELECT warehouse_id, product_id, SUM(qty) AS qty, MIN(due) AS due FROM (
         SELECT po.warehouse_id, d.product_id, GREATEST(d.quantity - d.quantity_received, 0) * d.unit_factor AS qty,
                COALESCE(d.expected_date, po.expected_date) AS due
           FROM purchase_orders_details d JOIN purchase_orders po ON po.id = d.purchase_order_id
          WHERE po.status IN ('approved', 'partially_received') AND d.quantity > d.quantity_received
         UNION ALL
         SELECT o.output_warehouse_id, o.product_id, GREATEST(o.quantity_planned - o.quantity_produced, 0), COALESCE(o.planned_end, o.planned_start)
           FROM production_orders o WHERE o.status IN ('created', 'released', 'in_process')
       ) x GROUP BY 1, 2
     ), pairs AS (
       SELECT warehouse_id, product_id FROM bal
       UNION SELECT warehouse_id, product_id FROM mov
       UNION SELECT warehouse_id, product_id FROM stock_policies
       UNION SELECT warehouse_id, product_id FROM incoming WHERE warehouse_id IS NOT NULL
     )
     SELECT w.code || ' · ' || w.name AS warehouse, p.code AS "productCode", p.name AS "productName", f.name AS family,
            u.code AS unit, u.decimals, p.is_purchased AS "isPurchased", p.is_manufactured AS "isManufactured",
            p.lead_time_days AS "leadDays",
            COALESCE(bal.qty, 0)::float AS quantity, COALESCE(bal.avail, 0)::float AS available,
            sp.min_qty::float AS "minQty", sp.max_qty::float AS "maxQty",
            COALESCE(mov.out_qty, 0)::float AS "outQty", COALESCE(inc.qty, 0)::float AS "onOrder",
            to_char(inc.due, 'YYYY-MM-DD') AS "nextArrival",
            CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE COALESCE(p.standard_cost, 0) END::float AS "avgCost",
            to_char(mov.last_out, 'YYYY-MM-DD') AS "lastOut", to_char(mov.last_in, 'YYYY-MM-DD') AS "lastIn",
            fn_rate_on('USD', CURRENT_DATE)::float AS usd
       FROM pairs
       JOIN warehouses w ON w.id = pairs.warehouse_id
       JOIN products p ON p.id = pairs.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN catalogs_product_families f ON f.id = p.family_id
       LEFT JOIN bal ON bal.warehouse_id = pairs.warehouse_id AND bal.product_id = pairs.product_id
       LEFT JOIN mov ON mov.warehouse_id = pairs.warehouse_id AND mov.product_id = pairs.product_id
       LEFT JOIN incoming inc ON inc.warehouse_id = pairs.warehouse_id AND inc.product_id = pairs.product_id
       LEFT JOIN stock_policies sp ON sp.warehouse_id = pairs.warehouse_id AND sp.product_id = pairs.product_id
       LEFT JOIN stock_valuation v ON v.warehouse_id = pairs.warehouse_id AND v.product_id = pairs.product_id
      WHERE p.is_active AND p.is_stockable AND w.is_active AND ($1::uuid[] IS NULL OR pairs.warehouse_id = ANY($1))
      ORDER BY w.order_list, p.code`,
    [warehouseScopeOf(ctx.access, "INV_STOCK"), ctx.from, ctx.to]
  );
}

const roundUp = (v: number, decimals: number) => {
  const f = 10 ** Math.max(0, decimals);
  return Math.ceil(v * f - 1e-9) / f;
};

const today = () => new Date().toISOString().slice(0, 10);

const usdOf = (amount: number, rate: number | null) => (rate ? amount / rate : null);

export const INVENTORY_REPORTS: ReportDef[] = [
  {
    code: "REPLENISHMENT",
    name: "Reposición sugerida",
    description: "Qué comprar o fabricar hoy: productos cuyo disponible más lo que viene en camino no alcanza su punto de pedido, con la cantidad sugerida y su costo.",
    group: "Inventario",
    module: "INV_STOCK",
    ranged: true,
    compare: false,
    columns: [
      { key: "warehouse", header: "Almacén", type: "text", width: 22 },
      { key: "action", header: "Acción", type: "text", width: 10 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 36 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "available", header: "Disponible", type: "qty" },
      { key: "onOrder", header: "En camino", type: "qty" },
      { key: "minQty", header: "Mínimo", type: "qty" },
      { key: "maxQty", header: "Máximo", type: "qty" },
      { key: "daily", header: "Consumo diario", type: "qty" },
      { key: "coverDays", header: "Días de cobertura", type: "int" },
      { key: "leadDays", header: "Plazo (días)", type: "int" },
      { key: "reorderPoint", header: "Punto de pedido", type: "qty" },
      { key: "suggested", header: "Cantidad sugerida", type: "qty" },
      { key: "avgCost", header: "Costo unitario", type: "money" },
      { key: "estimated", header: "Costo estimado", type: "money", total: true },
      { key: "estimatedUsd", header: "Costo estimado USD", type: "money", usd: true, total: true }
    ],
    rows: async (ctx) => {
      const days = daysIn(ctx.from, ctx.to);
      const out: Row[] = [];
      for (const p of await positions(ctx)) {
        if (!p.isPurchased && !p.isManufactured) continue;
        const daily = p.outQty / days;
        const lead = p.leadDays ?? DEFAULT_LEAD_DAYS;
        const reorderPoint = Math.max(p.minQty ?? 0, daily * lead);
        const target = p.maxQty && p.maxQty > 0 ? p.maxQty : Math.max(p.minQty ?? 0, daily * (lead + SAFETY_DAYS));
        const position = p.available + p.onOrder;
        if (reorderPoint <= 0 || position > reorderPoint) continue;
        const suggested = roundUp(Math.max(0, target - position), p.decimals);
        if (suggested <= 0) continue;
        const estimated = suggested * p.avgCost;
        out.push({
          warehouse: p.warehouse,
          action: p.isManufactured ? "Fabricar" : "Comprar",
          productCode: p.productCode,
          productName: p.productName,
          unit: p.unit,
          available: p.available,
          onOrder: p.onOrder,
          minQty: p.minQty,
          maxQty: p.maxQty,
          daily: Math.round(daily * 1000) / 1000,
          coverDays: daily > 0 ? Math.floor(Math.max(0, p.available) / daily) : null,
          leadDays: lead,
          reorderPoint: Math.round(reorderPoint * 1000) / 1000,
          suggested,
          avgCost: p.avgCost,
          estimated,
          estimatedUsd: usdOf(estimated, p.usd),
          _usd: p.usd,
          _out: p.available <= 0
        });
      }
      return out.sort((a, b) => Number(a.coverDays ?? -1) - Number(b.coverDays ?? -1) || String(a.productCode).localeCompare(String(b.productCode)));
    },
    kpis: [
      { key: "items", label: "Productos a reponer", type: "int", value: (r) => r.length },
      { key: "buy", label: "A comprar", type: "int", value: (r) => r.filter((x) => x.action === "Comprar").length },
      { key: "make", label: "A fabricar", type: "int", value: (r) => r.filter((x) => x.action === "Fabricar").length },
      { key: "empty", label: "Ya sin existencia", type: "int", value: (r) => r.filter((x) => x._out).length },
      { key: "estimated", label: "Costo estimado", type: "money", value: (r) => sum(r, "estimated"), usd: (r) => sumUsd(r, "estimated"), help: "Cantidad sugerida × costo promedio actual" }
    ],
    charts: [
      {
        title: "Los 10 de mayor costo de reposición",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "estimated", label: "Costo estimado" }],
        data: (rows) => groupSum(rows, "productName", ["estimated"], { sortBy: "estimated", top: 10 })
      }
    ]
  },
  {
    code: "STOCKOUT_RISK",
    name: "Riesgo de quiebre de stock",
    description: `Productos que, al ritmo de salida del rango, se agotan en los próximos ${RISK_DAYS} días; muestra si lo que viene en camino llega antes.`,
    group: "Inventario",
    module: "INV_STOCK",
    ranged: true,
    compare: false,
    columns: [
      { key: "risk", header: "Riesgo", type: "text", width: 12 },
      { key: "warehouse", header: "Almacén", type: "text", width: 22 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 36 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "available", header: "Disponible", type: "qty" },
      { key: "daily", header: "Salida diaria", type: "qty" },
      { key: "coverDays", header: "Días de cobertura", type: "int" },
      { key: "stockoutDate", header: "Se agota el", type: "date" },
      { key: "onOrder", header: "En camino", type: "qty" },
      { key: "nextArrival", header: "Próxima llegada", type: "date" },
      { key: "inTime", header: "¿Llega a tiempo?", type: "text", width: 12 },
      { key: "dailyValue", header: "Venta en riesgo por día (al costo)", type: "money", total: true }
    ],
    rows: async (ctx) => {
      const days = daysIn(ctx.from, ctx.to);
      const now = today();
      const out: Row[] = [];
      for (const p of await positions(ctx)) {
        if (p.outQty <= 0) continue;
        const daily = p.outQty / days;
        const cover = Math.max(0, p.available) / daily;
        if (cover > RISK_DAYS) continue;
        const coverDays = Math.floor(cover);
        const stockoutDate = shiftIso(now, coverDays);
        out.push({
          risk: coverDays <= 0 ? "Agotado" : coverDays <= 3 ? "1 a 3 días" : coverDays <= 7 ? "4 a 7 días" : "8 a 14 días",
          warehouse: p.warehouse,
          productCode: p.productCode,
          productName: p.productName,
          unit: p.unit,
          available: p.available,
          daily: Math.round(daily * 1000) / 1000,
          coverDays,
          stockoutDate,
          onOrder: p.onOrder,
          nextArrival: p.nextArrival,
          inTime: p.onOrder <= 0 ? "Sin pedido" : p.nextArrival && p.nextArrival <= stockoutDate ? "Sí" : "No",
          dailyValue: daily * p.avgCost,
          _usd: p.usd,
          _one: 1
        });
      }
      return out.sort((a, b) => Number(a.coverDays) - Number(b.coverDays) || Number(b.dailyValue) - Number(a.dailyValue));
    },
    kpis: [
      { key: "out", label: "Agotados", type: "int", value: (r) => r.filter((x) => x.risk === "Agotado").length, help: "Tienen salida en el rango y hoy no tienen disponible" },
      { key: "week", label: "Se agotan en 7 días", type: "int", value: (r) => r.filter((x) => Number(x.coverDays) > 0 && Number(x.coverDays) <= 7).length },
      { key: "twoWeeks", label: "Se agotan en 8 a 14 días", type: "int", value: (r) => r.filter((x) => Number(x.coverDays) > 7).length },
      { key: "uncovered", label: "Sin reposición a tiempo", type: "int", value: (r) => r.filter((x) => x.inTime !== "Sí").length, help: "Sin pedido en camino, o el pedido llega después de agotarse" }
    ],
    charts: [
      {
        title: "Productos por plazo hasta agotarse",
        kind: "bar",
        type: "int",
        series: [{ key: "_one", label: "Productos" }],
        data: (rows) => groupSum(rows, "risk", ["_one"], { order: ["Agotado", "1 a 3 días", "4 a 7 días", "8 a 14 días"] })
      }
    ]
  },
  {
    code: "SLOW_MOVERS",
    name: "Productos sin movimiento",
    description: "Existencias sin ninguna salida en el rango (ventas, despachos ni consumos): el capital inmovilizado, con su última salida y entrada.",
    group: "Inventario",
    module: "INV_STOCK",
    ranged: true,
    defaultDays: 90,
    compare: false,
    columns: [
      { key: "warehouse", header: "Almacén", type: "text", width: 22 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 36 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "quantity", header: "Existencia", type: "qty" },
      { key: "avgCost", header: "Costo promedio", type: "money" },
      { key: "value", header: "Valor", type: "money", total: true },
      { key: "valueUsd", header: "Valor USD", type: "money", usd: true, total: true },
      { key: "lastOut", header: "Última salida", type: "date" },
      { key: "daysIdle", header: "Días sin salida", type: "int" },
      { key: "lastIn", header: "Última entrada", type: "date" }
    ],
    rows: async (ctx) => {
      const all = await positions(ctx);
      const totalValue = all.reduce((s, p) => s + Math.max(0, p.quantity) * p.avgCost, 0);
      const now = today();
      return all
        .filter((p) => p.quantity > 0 && p.outQty <= 0)
        .map((p) => {
          const value = p.quantity * p.avgCost;
          return {
            warehouse: p.warehouse,
            productCode: p.productCode,
            productName: p.productName,
            family: p.family,
            unit: p.unit,
            quantity: p.quantity,
            avgCost: p.avgCost,
            value,
            valueUsd: usdOf(value, p.usd),
            lastOut: p.lastOut,
            daysIdle: p.lastOut ? daysIn(p.lastOut, now) - 1 : null,
            lastIn: p.lastIn,
            _usd: p.usd,
            _totalValue: totalValue
          };
        })
        .sort((a, b) => b.value - a.value);
    },
    kpis: [
      { key: "items", label: "Productos sin salida", type: "int", value: (r) => r.length },
      { key: "value", label: "Capital inmovilizado", type: "money", value: (r) => sum(r, "value"), usd: (r) => sumUsd(r, "value") },
      { key: "share", label: "Del inventario total", type: "pct", value: (r) => (r.length ? ratio(sum(r, "value"), Number(r[0]._totalValue)) : null), help: "Valor sin movimiento sobre el valor de todo el inventario del alcance" },
      { key: "never", label: "Nunca han salido", type: "int", value: (r) => r.filter((x) => !x.lastOut).length }
    ],
    charts: [
      {
        title: "Capital inmovilizado por familia",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "value", label: "Valor" }],
        data: (rows) => groupSum(rows, (r) => String(r.family ?? "Sin familia"), ["value"], { sortBy: "value", top: 12 })
      }
    ]
  }
];
