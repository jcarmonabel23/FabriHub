/**
 * @project FabriHub - API
 * @file src/modules/planning/mrp.ts
 * @description MRP (tesis: método Planificación.Calcular): plan maestro → explosión por niveles → necesidades
 *              netas → órdenes sugeridas de fabricación (OP) y de compra (OC)
 *
 * @overview
 * Cubetas mensuales, desde el primer mes planificable durante PRODUCTION.mrp_horizon_months.
 *  1. Productos involucrados: los del MPS y todos sus componentes (fórmulas por defecto, multinivel).
 *     Cada uno recibe su CÓDIGO DE NIVEL MÁS BAJO; se calculan en ese orden, así un componente que
 *     aparece en varios niveles junta toda su demanda antes de netearse.
 *  2. Terminados (tienen MPS): el MPS ES su orden planificada; no se vuelve a netear.
 *  3. Resto, por mes:  disponible proyectado = anterior + recepciones programadas − brutas;
 *     si cae bajo el stock de seguridad → neta → orden planificada con tamaño de lote
 *     (fabricados: múltiplo de la cantidad base de su fórmula; comprados: unidades de compra enteras).
 *  4. La orden se LANZA antes de la fecha de necesidad según el tiempo de reposición del producto.
 *     Si se fabrica, su lanzamiento genera necesidades brutas de los componentes en ese mes.
 *  Disponible inicial = existencia aprobada no reservada (todos los almacenes).
 *  Recepciones programadas = OC aprobadas pendientes, OP abiertas y lotes en cuarentena (mes 1).
 *  Convertir: fabricar → OP 'planned'; comprar → OC en borrador agrupada por proveedor y almacén.
 */

import { z } from "zod";
import type pg from "pg";
import type { Request } from "express";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, forbidden, handler, idParams, notFound } from "../../lib/http.js";
import { modulePermissions } from "../../security/authorize.js";
import { authOf, txCtx } from "../../security/context.js";
import { insertProductionOrder } from "../production/orders.js";
import { insertPurchaseOrder } from "../purchases/orders.js";
import { firstPlannableMonth } from "./plans.js";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-9;
const pad = (n: number) => String(n).padStart(2, "0");

interface Item {
  id: string;
  code: string;
  isManufactured: boolean;
  isPurchased: boolean;
  leadDays: number;
  purchaseFactor: number;
  formula: { base: number; lines: { componentId: string; qty: number; scrap: number }[] } | null;
  llc: number;
  onHand: number;
  safety: number;
}

type Buckets = Map<number, number>;
const add = (b: Buckets, m: number, q: number) => b.set(m, round6((b.get(m) ?? 0) + q));

export async function runMrp(client: pg.PoolClient, periodId: string) {
  const period = await one<{ id: string; year: number; status: string }>(`SELECT id, year, status FROM planning_periods WHERE id = $1 FOR UPDATE`, [periodId], client);
  if (!period) throw notFound("Período no encontrado");
  if (period.status !== "open") throw conflict("PERIOD_CLOSED", "El período está cerrado");
  const first = await firstPlannableMonth(client, period.year);
  if (!first) throw conflict("PAST_PERIOD", "El período ya pasó: no se planifica");
  const horizon = Number((await one<{ v: string }>(`SELECT COALESCE(fn_parameter('PRODUCTION', 'mrp_horizon_months')::text, '3') AS v`, [], client))!.v);
  const last = Math.min(12, first + horizon - 1);
  const months = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`, [], client))!.d;
  /** Mes de una fecha dentro del horizonte (antes → primer mes; después → null) */
  const bucketOf = (date: string): number | null => {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    if (y < period.year || (y === period.year && m < first)) return first;
    if (y > period.year || m > last) return null;
    return m;
  };

  // ---------------------------------------------------------------- MPS
  const mpsRows = await query<{ product_id: string; month: number; quantity: string }>(
    `SELECT product_id, month, quantity FROM plans WHERE period_id = $1 AND plan_type = 'mps' AND month BETWEEN $2 AND $3 AND quantity > 0`,
    [periodId, first, last],
    client
  );
  const mps = new Map<string, Buckets>();
  for (const r of mpsRows) add(mps.get(r.product_id) ?? mps.set(r.product_id, new Map()).get(r.product_id)!, r.month, Number(r.quantity));
  if (mps.size === 0) throw badRequest("NO_MPS", "El plan maestro está vacío en el horizonte: genérelo desde el plan de ventas");

  // ---------------------------------------------------------------- Productos y fórmulas (multinivel)
  const items = new Map<string, Item>();
  const loadItems = async (ids: string[]) => {
    const rows = await query<{
      id: string;
      code: string;
      is_manufactured: boolean;
      is_purchased: boolean;
      lead_time_days: number;
      purchase_factor: string;
      base: string | null;
      lines: { componentId: string; qty: number; scrap: number }[] | null;
      on_hand: string;
      safety: string;
    }>(
      `SELECT p.id, p.code, p.is_manufactured, p.is_purchased, p.lead_time_days, p.purchase_factor, f.base_quantity AS base,
              (SELECT json_agg(json_build_object('componentId', d.component_id, 'qty', d.quantity::float, 'scrap', d.scrap_pct::float))
                 FROM formulas_details d WHERE d.formula_id = f.id) AS lines,
              COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = p.id), 0) AS on_hand,
              COALESCE((SELECT SUM(sp.min_qty) FROM stock_policies sp WHERE sp.product_id = p.id), 0) AS safety
         FROM products p LEFT JOIN formulas f ON f.product_id = p.id AND f.is_default AND f.is_active
        WHERE p.id = ANY($1)`,
      [ids],
      client
    );
    for (const r of rows) {
      items.set(r.id, {
        id: r.id,
        code: r.code,
        isManufactured: r.is_manufactured,
        isPurchased: r.is_purchased,
        leadDays: r.lead_time_days,
        purchaseFactor: Number(r.purchase_factor),
        formula: r.is_manufactured && r.base && r.lines ? { base: Number(r.base), lines: r.lines } : null,
        llc: 0,
        onHand: Number(r.on_hand),
        safety: Number(r.safety)
      });
    }
  };
  let frontier = [...mps.keys()];
  while (frontier.length) {
    await loadItems(frontier.filter((id) => !items.has(id)));
    const next = new Set<string>();
    for (const id of frontier) for (const l of items.get(id)?.formula?.lines ?? []) if (!items.has(l.componentId)) next.add(l.componentId);
    frontier = [...next];
  }
  // Código de nivel más bajo: un componente queda en el nivel más profundo en que aparece
  const setLevel = (id: string, level: number, path: Set<string>) => {
    const it = items.get(id)!;
    if (path.has(id)) throw conflict("BOM_CYCLE", `Ciclo en las fórmulas con ${it.code}`);
    if (level > it.llc) it.llc = level;
    const next = new Set(path).add(id);
    for (const l of it.formula?.lines ?? []) setLevel(l.componentId, level + 1, next);
  };
  for (const id of mps.keys()) setLevel(id, 0, new Set());

  // ---------------------------------------------------------------- Recepciones programadas
  const scheduled = new Map<string, Buckets>();
  const sched = (pid: string) => scheduled.get(pid) ?? scheduled.set(pid, new Map()).get(pid)!;
  const ids = [...items.keys()];
  const poRows = await query<{ product_id: string; due: string; qty: string }>(
    `SELECT d.product_id, to_char(COALESCE(d.expected_date, po.expected_date, po.order_date), 'YYYY-MM-DD') AS due,
            (d.quantity - d.quantity_received) * d.unit_factor AS qty
       FROM purchase_orders_details d JOIN purchase_orders po ON po.id = d.purchase_order_id
      WHERE po.status IN ('pending_approval', 'approved', 'partially_received') AND d.quantity > d.quantity_received AND d.product_id = ANY($1)`,
    [ids],
    client
  );
  const opRows = await query<{ product_id: string; due: string; qty: string }>(
    `SELECT product_id, to_char(COALESCE(planned_end, planned_start), 'YYYY-MM-DD') AS due, quantity_planned - quantity_produced AS qty
       FROM production_orders WHERE status IN ('planned', 'created', 'released', 'in_process') AND quantity_planned > quantity_produced AND product_id = ANY($1)`,
    [ids],
    client
  );
  const qcRows = await query<{ product_id: string; qty: string }>(
    `SELECT b.product_id, SUM(b.quantity) AS qty FROM stock_balances b JOIN lots l ON l.id = b.lot_id
      WHERE l.quality_status = 'quarantine' AND b.quantity > 0 AND b.product_id = ANY($1) GROUP BY b.product_id`,
    [ids],
    client
  );
  for (const r of [...poRows, ...opRows]) {
    const m = bucketOf(r.due);
    if (m !== null) add(sched(r.product_id), m, Number(r.qty));
  }
  for (const r of qcRows) add(sched(r.product_id), first, Number(r.qty));

  // ---------------------------------------------------------------- Cálculo por niveles
  const gross = new Map<string, Buckets>();
  const grossOf = (pid: string) => gross.get(pid) ?? gross.set(pid, new Map()).get(pid)!;
  // Fecha real de necesidad de la demanda dependiente: el lanzamiento más temprano de las órdenes padre del mes
  const needDates = new Map<string, Map<number, string>>();
  const markNeed = (pid: string, m: number, date: string) => {
    const byMonth = needDates.get(pid) ?? needDates.set(pid, new Map()).get(pid)!;
    const cur = byMonth.get(m);
    if (!cur || date < cur) byMonth.set(m, date);
  };
  const results: { productId: string; llc: number; month: number; gross: number; scheduled: number; projected: number; net: number; receipt: number; release: number }[] = [];
  const planned: { productId: string; kind: "make" | "buy"; month: number; quantity: number; net: number; due: string; release: string; late: boolean }[] = [];

  // Terminados: su demanda independiente (plan de ventas) es la necesidad bruta que muestra la tabla
  const salesRows = await query<{ product_id: string; month: number; quantity: string }>(
    `SELECT product_id, month, quantity FROM plans WHERE period_id = $1 AND plan_type = 'sales' AND month BETWEEN $2 AND $3 AND product_id = ANY($4)`,
    [periodId, first, last, [...mps.keys()]],
    client
  );
  for (const r of salesRows) add(grossOf(r.product_id), r.month, Number(r.quantity));

  const ordered = [...items.values()].sort((a, b) => a.llc - b.llc || a.code.localeCompare(b.code));
  for (const it of ordered) {
    const g = grossOf(it.id);
    const s = sched(it.id);
    const releases = new Map<number, number>();
    const receipts = new Map<number, number>();
    const nets = new Map<number, number>();
    const isEnd = mps.has(it.id);
    let poh = it.onHand;
    for (const m of months) {
      if (isEnd) {
        const q = mps.get(it.id)!.get(m) ?? 0;
        if (q > EPS) {
          receipts.set(m, q);
          nets.set(m, q);
        }
        poh = round6(poh + (s.get(m) ?? 0) + q - (g.get(m) ?? 0));
      } else {
        poh = round6(poh + (s.get(m) ?? 0) - (g.get(m) ?? 0));
        if (poh < it.safety - EPS) {
          const net = round6(it.safety - poh);
          const lot = it.formula ? it.formula.base : it.isPurchased ? it.purchaseFactor : 1;
          const q = round6(Math.ceil(round6(net / lot)) * lot);
          receipts.set(m, q);
          nets.set(m, net);
          poh = round6(poh + q);
        }
      }
      const q = receipts.get(m);
      if (q) {
        // Terminados: al inicio del mes (o hoy). Componentes: cuando se lanza la orden padre que los consume.
        const monthStart = `${period.year}-${pad(m)}-01`;
        const need = needDates.get(it.id)?.get(m) ?? monthStart;
        const due = need < today ? today : need;
        const relDate = new Date(`${due}T00:00:00Z`);
        relDate.setUTCDate(relDate.getUTCDate() - it.leadDays);
        const rel = relDate.toISOString().slice(0, 10);
        const relMonth = bucketOf(rel) ?? m;
        add(releases, relMonth, q);
        const kind = it.formula ? "make" : "buy";
        // Sin fórmula y sin comprarse no hay orden que sugerir (queda la necesidad en la tabla MRP)
        if (kind === "make" || it.isPurchased) planned.push({ productId: it.id, kind, month: m, quantity: q, net: nets.get(m) ?? q, due, release: rel < today ? today : rel, late: rel < today });
        // Explosión: el lanzamiento de una orden de fabricación crea demanda de sus componentes
        if (it.formula) {
          for (const l of it.formula.lines) {
            add(grossOf(l.componentId), relMonth, round6((q / it.formula.base) * l.qty * (1 + l.scrap / 100)));
            markNeed(l.componentId, relMonth, rel < today ? today : rel);
          }
        }
      }
      results.push({
        productId: it.id,
        llc: it.llc,
        month: m,
        gross: g.get(m) ?? 0,
        scheduled: s.get(m) ?? 0,
        projected: poh,
        net: nets.get(m) ?? 0,
        receipt: receipts.get(m) ?? 0,
        release: 0
      });
    }
    for (const r of results) if (r.productId === it.id) r.release = releases.get(r.month) ?? 0;
  }

  // ---------------------------------------------------------------- Guardar la corrida
  const run = await one<{ id: string }>(
    `INSERT INTO mrp_runs (period_id, first_month, months, products, suggestions, params, run_by)
     VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id`,
    [
      periodId,
      first,
      months.length,
      items.size,
      planned.length,
      JSON.stringify({ horizon, scheduledPurchaseLines: poRows.length, scheduledProductionOrders: opRows.length, quarantineProducts: qcRows.length })
    ],
    client
  );
  for (const r of results) {
    await client.query(
      `INSERT INTO mrp_results (run_id, product_id, low_level, month, gross, scheduled, projected, net, planned_receipt, planned_release)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [run!.id, r.productId, r.llc, r.month, r.gross, r.scheduled, r.projected, r.net, r.receipt, r.release]
    );
  }
  for (const p of planned) {
    await client.query(
      `INSERT INTO mrp_suggestions (run_id, product_id, kind, quantity, net_quantity, release_date, due_date, is_late, supplier_id, warehouse_id)
       VALUES ($1, $2, $3::text, $4, $5, $6, $7, $8,
               CASE WHEN $3::text = 'buy' THEN COALESCE(
                 (SELECT s.id FROM suppliers s JOIN price_lists_items i ON i.price_list_id = s.price_list_id JOIN price_lists l ON l.id = i.price_list_id
                   WHERE i.product_id = $2 AND s.is_active AND l.is_active ORDER BY i.price LIMIT 1),
                 (SELECT po.supplier_id FROM purchase_orders_details d JOIN purchase_orders po ON po.id = d.purchase_order_id
                   WHERE d.product_id = $2 AND po.status <> 'cancelled' ORDER BY po.order_date DESC LIMIT 1)) END,
               COALESCE(
                 (SELECT sp.warehouse_id FROM stock_policies sp WHERE sp.product_id = $2 ORDER BY sp.min_qty DESC LIMIT 1),
                 (SELECT v.warehouse_id FROM stock_valuation v WHERE v.product_id = $2 ORDER BY v.quantity DESC LIMIT 1),
                 (SELECT w.id FROM warehouses w JOIN products p ON p.id = $2 JOIN catalogs_product_types t ON t.id = p.product_type_id
                   WHERE w.is_active AND w.code = CASE t.nature WHEN 'packaging' THEN 'ME' WHEN 'finished' THEN 'PT' ELSE 'MP' END)))`,
      [run!.id, p.productId, p.kind, p.quantity, p.net, p.release, p.due, p.late]
    );
  }
  return run!.id;
}

// ================================================================== Consultas

export async function runDetail(id: string) {
  const run = await one<{ periodId: string }>(
    `SELECT r.id, r.period_id AS "periodId", pp.code AS "periodCode", pp.year, r.first_month AS "firstMonth", r.months, r.products, r.suggestions,
            r.params, r.run_at AS "runAt", u.names AS "runBy"
       FROM mrp_runs r JOIN planning_periods pp ON pp.id = r.period_id LEFT JOIN users u ON u.id = r.run_by WHERE r.id = $1`,
    [id]
  );
  if (!run) throw notFound("Corrida no encontrada");
  const results = await query(
    `SELECT p.id AS "productId", p.code, p.name, u.code AS "unitCode", MIN(r.low_level)::int AS level, p.lead_time_days AS "leadDays",
            json_agg(json_build_object('month', r.month, 'gross', r.gross::float, 'scheduled', r.scheduled::float, 'projected', r.projected::float,
                                       'net', r.net::float, 'receipt', r.planned_receipt::float, 'release', r.planned_release::float) ORDER BY r.month) AS buckets
       FROM mrp_results r JOIN products p ON p.id = r.product_id JOIN catalogs_units u ON u.id = p.stock_unit_id
      WHERE r.run_id = $1 GROUP BY p.id, u.code ORDER BY MIN(r.low_level), p.code`,
    [id]
  );
  const suggestions = await query(
    `SELECT s.id, s.kind, s.status, s.quantity::float AS quantity, s.net_quantity::float AS "netQuantity",
            to_char(s.release_date, 'YYYY-MM-DD') AS "releaseDate", to_char(s.due_date, 'YYYY-MM-DD') AS "dueDate", s.is_late AS "isLate",
            p.id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
            pu.code AS "purchaseUnitCode", p.purchase_factor::float AS "purchaseFactor",
            s.supplier_id AS "supplierId", sup.legal_name AS "supplierName", s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
            s.document_module AS "documentModule", s.document_id AS "documentId", s.document_number AS "documentNumber",
            du.names AS "decidedBy", s.decided_at AS "decidedAt"
       FROM mrp_suggestions s
       JOIN products p ON p.id = s.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN catalogs_units pu ON pu.id = p.purchase_unit_id
       LEFT JOIN suppliers sup ON sup.id = s.supplier_id
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN users du ON du.id = s.decided_by
      WHERE s.run_id = $1 ORDER BY s.release_date, s.kind, p.code`,
    [id]
  );
  return { ...run, results, suggestions };
}

export const runForPeriod = handler({ params: idParams }, async ({ params, req }) => {
  const runId = await withTx(txCtx(req), (client) => runMrp(client, params.id));
  return runDetail(runId);
});

export const listRuns = handler({ params: idParams }, ({ params }) =>
  query(
    `SELECT r.id, r.run_at AS "runAt", u.names AS "runBy", r.first_month AS "firstMonth", r.months, r.products, r.suggestions,
            (SELECT COUNT(*) FROM mrp_suggestions s WHERE s.run_id = r.id AND s.status = 'converted')::int AS converted
       FROM mrp_runs r LEFT JOIN users u ON u.id = r.run_by WHERE r.period_id = $1 ORDER BY r.run_at DESC`,
    [params.id]
  )
);

export const getRun = handler({ params: idParams }, ({ params }) => runDetail(params.id));

// ================================================================== Sugerencias

export const updateSuggestion = handler(
  {
    params: idParams,
    body: z.object({ quantity: z.number().positive().max(1e12).optional(), supplierId: z.uuid().nullish(), warehouseId: z.uuid().nullish() })
  },
  async ({ params, body: b, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ run_id: string }>(
        `UPDATE mrp_suggestions SET quantity = COALESCE($2, quantity),
                supplier_id = CASE WHEN $3::boolean THEN $4 ELSE supplier_id END,
                warehouse_id = CASE WHEN $5::boolean THEN $6 ELSE warehouse_id END
          WHERE id = $1 AND status = 'open' RETURNING run_id`,
        [params.id, b.quantity ?? null, b.supplierId !== undefined, b.supplierId ?? null, b.warehouseId !== undefined, b.warehouseId ?? null],
        client
      )
    );
    if (!row) throw conflict("NOT_OPEN", "La sugerencia ya fue convertida o descartada");
    return runDetail(row.run_id);
  }
);

export const dismissSuggestion = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one<{ run_id: string }>(
      `UPDATE mrp_suggestions SET status = 'dismissed', decided_by = fn_current_app_user(), decided_at = NOW() WHERE id = $1 AND status = 'open' RETURNING run_id`,
      [params.id],
      client
    )
  );
  if (!row) throw conflict("NOT_OPEN", "La sugerencia ya fue convertida o descartada");
  return runDetail(row.run_id);
});

/** El usuario debe poder crear el documento en su propio módulo (la planificación no da atajos de permisos) */
async function scopeFor(req: Request, moduleCode: string, label: string) {
  const userId = authOf(req).userId;
  const perms = (await modulePermissions(userId, moduleCode))?.permissions ?? [];
  if (!perms.includes("access") || !perms.includes("add_new")) throw forbidden("NO_DOCUMENT_PERMISSION", `No tiene permiso para crear ${label}`);
  if (perms.includes("view_all")) return null;
  return (await query<{ warehouse_id: string }>(`SELECT warehouse_id FROM users_warehouses WHERE user_id = $1`, [userId])).map((r) => r.warehouse_id);
}

export const convertSuggestions = handler({ body: z.object({ ids: z.array(z.uuid()).min(1).max(200) }) }, async ({ body, req }) => {
  const rows = await query<{ id: string; kind: string; run_id: string; product_id: string; code: string; quantity: string; release: string; due: string; supplier_id: string | null; warehouse_id: string | null; purchase_unit_id: string | null; stock_unit_id: string; purchase_factor: string }>(
    `SELECT s.id, s.kind, s.run_id, s.product_id, p.code, s.quantity, to_char(s.release_date, 'YYYY-MM-DD') AS release, to_char(s.due_date, 'YYYY-MM-DD') AS due,
            s.supplier_id, s.warehouse_id, p.purchase_unit_id, p.stock_unit_id, p.purchase_factor
       FROM mrp_suggestions s JOIN products p ON p.id = s.product_id WHERE s.id = ANY($1) AND s.status = 'open'`,
    [body.ids]
  );
  if (rows.length !== body.ids.length) throw conflict("NOT_OPEN", "Alguna sugerencia ya fue convertida o descartada");
  const makes = rows.filter((r) => r.kind === "make");
  const buys = rows.filter((r) => r.kind === "buy");
  const prodScope = makes.length ? await scopeFor(req, "PRD_ORDERS", "órdenes de producción") : null;
  if (buys.length) await scopeFor(req, "PUR_ORDERS", "órdenes de compra");
  for (const b of buys) {
    if (!b.supplier_id) throw badRequest("SUPPLIER_REQUIRED", `${b.code}: indique el proveedor antes de convertir`);
    if (!b.warehouse_id) throw badRequest("WAREHOUSE_REQUIRED", `${b.code}: indique el almacén de recepción`);
  }

  const documents = await withTx(txCtx(req), async (client) => {
    const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`, [], client))!.d;
    const created: { module: string; number: string; id: string }[] = [];
    const mark = (ids: string[], module: string, doc: { id: string; number: string }) =>
      client.query(
        `UPDATE mrp_suggestions SET status = 'converted', document_module = $2, document_id = $3, document_number = $4, decided_by = fn_current_app_user(), decided_at = NOW()
          WHERE id = ANY($1) AND status = 'open'`,
        [ids, module, doc.id, doc.number]
      );

    // Fabricar: una OP planificada por sugerencia
    for (const s of makes) {
      const op = await insertProductionOrder(
        client,
        { productId: s.product_id, quantity: Number(s.quantity), plannedStart: s.release > today ? s.release : today, plannedEnd: s.due >= today ? s.due : today, priority: 3, notes: "Sugerida por el MRP" },
        prodScope,
        "planned"
      );
      await mark([s.id], "PRODUCTION", op);
      created.push({ module: "PRODUCTION", ...op });
    }

    // Comprar: una OC en borrador por proveedor y almacén, en unidad de compra
    const groups = new Map<string, typeof buys>();
    for (const b of buys) groups.set(`${b.supplier_id}|${b.warehouse_id}`, [...(groups.get(`${b.supplier_id}|${b.warehouse_id}`) ?? []), b]);
    for (const group of groups.values()) {
      const expected = group.map((g) => g.due).sort()[0];
      const po = await insertPurchaseOrder(client, {
        supplierId: group[0].supplier_id!,
        warehouseId: group[0].warehouse_id!,
        orderDate: today,
        expectedDate: expected >= today ? expected : today,
        notes: "Generada desde el MRP",
        lines: group.map((g) => {
          const factor = g.purchase_unit_id ? Number(g.purchase_factor) : 1;
          return {
            productId: g.product_id,
            unitId: g.purchase_unit_id ?? g.stock_unit_id,
            quantity: round6(Number(g.quantity) / factor),
            expectedDate: g.due >= today ? g.due : today
          };
        })
      });
      await mark(
        group.map((g) => g.id),
        "PURCHASES",
        po
      );
      created.push({ module: "PURCHASES", ...po });
    }
    return created;
  });
  return { documents, run: await runDetail(rows[0].run_id) };
});
