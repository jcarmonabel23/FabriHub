/**
 * @project FabriHub - API
 * @file src/modules/production/orders.ts
 * @description Órdenes de producción (PRD_ORDERS) — tesis 2.1.4 (ciclo) y Clase Orden de Producción
 *
 * @overview
 * created ──liberar──▶ released ──consumir / iniciar etapa──▶ in_process ──confirmar──▶ confirmed ──cerrar──▶ closed
 *    │  ◀──devolver a creada──┘                                                     (cancelled: antes de consumir)
 *
 *  - Crear: copia la fórmula (un nivel, con merma) a los materiales y la ruta a los procesos,
 *    y calcula el costo ESTÁNDAR (materiales a costo estándar + horas teóricas × tarifas).
 *  - Liberar (permiso release): verifica existencia y RESERVA cada material por FEFO en lotes
 *    aprobados y vigentes. Un faltante en un componente CRÍTICO impide liberar; los demás faltantes
 *    se informan y se reserva lo que haya.
 *  - Consumir: salida CONS_PROD por almacén, primero de lo reservado (FEFO) y luego de lo libre.
 *    El costo sale al promedio ponderado del motor de inventario.
 *  - Confirmar: exige todas las etapas terminadas; entra el terminado (ENT_PROD) en un lote NUEVO en
 *    cuarentena, al costo REAL (materiales consumidos + horas reales × tarifas) ÷ cantidad fabricada.
 *    Quien confirma queda como creador del lote: no podrá liberarlo en Calidad.
 *  - Cerrar (permiso close): suelta las reservas sobrantes y fija la variación real − estándar.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { HttpError, badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "../inventory/scope.js";
import { stdCostSql } from "./masters.js";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-9;

interface OrderRow {
  id: string;
  number: string;
  status: string;
  product_id: string;
  formula_id: string;
  route_id: string | null;
  quantity_planned: string;
  materials_warehouse_id: string;
  output_warehouse_id: string;
  lot_code: string | null;
  std_material_cost: string;
  std_labor_cost: string;
  std_overhead_cost: string;
  created_by: string | null;
}

async function lockOrder(client: pg.PoolClient, id: string): Promise<OrderRow> {
  const o = await one<OrderRow>(`SELECT * FROM production_orders WHERE id = $1 FOR UPDATE`, [id], client);
  if (!o) throw notFound("Orden de producción no encontrada");
  return o;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "planificada",
  created: "creada",
  released: "liberada",
  in_process: "en proceso",
  confirmed: "confirmada",
  closed: "cerrada",
  cancelled: "anulada"
};

function assertStatus(o: OrderRow, allowed: string[], action: string) {
  if (!allowed.includes(o.status)) {
    throw conflict("INVALID_STATUS", `No se puede ${action} la orden ${o.number}: está ${STATUS_LABEL[o.status] ?? o.status}`);
  }
}

async function conceptId(client: pg.PoolClient, code: string) {
  const c = await one<{ id: string; lot_status_on_entry: string }>(
    `SELECT id, lot_status_on_entry FROM catalogs_movement_concepts WHERE code = $1 AND is_active`,
    [code],
    client
  );
  if (!c) throw conflict("CONCEPT_MISSING", `El concepto de inventario ${code} no existe o está inactivo`);
  return c;
}

// ================================================================== Consultas

const HEADER = `SELECT o.id, o.number, o.status, o.priority,
  o.product_id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
  p.is_lot_controlled AS "isLotControlled", p.shelf_life_days AS "shelfLifeDays",
  o.formula_id AS "formulaId", f.code AS "formulaCode", f.version AS "formulaVersion",
  o.route_id AS "routeId", r.code AS "routeCode",
  o.production_center_id AS "productionCenterId", pc.code AS "productionCenterCode", pc.name AS "productionCenterName",
  o.materials_warehouse_id AS "materialsWarehouseId", mw.code AS "materialsWarehouseCode",
  o.output_warehouse_id AS "outputWarehouseId", ow.code AS "outputWarehouseCode",
  o.quantity_planned::float AS "quantityPlanned", o.quantity_produced::float AS "quantityProduced",
  to_char(o.planned_start, 'YYYY-MM-DD') AS "plannedStart", to_char(o.planned_end, 'YYYY-MM-DD') AS "plannedEnd",
  (o.planned_end < CURRENT_DATE AND o.status IN ('created', 'released', 'in_process')) AS "isLate",
  o.lot_code AS "lotCode", o.output_lot_id AS "outputLotId", ol.lot_code AS "outputLotCode", ol.quality_status AS "outputLotStatus",
  o.output_movement_id AS "outputMovementId", om.number AS "outputMovementNumber",
  o.std_material_cost::float AS "stdMaterialCost", o.std_labor_cost::float AS "stdLaborCost", o.std_overhead_cost::float AS "stdOverheadCost",
  o.real_material_cost::float AS "realMaterialCost", o.real_labor_cost::float AS "realLaborCost", o.real_overhead_cost::float AS "realOverheadCost",
  o.real_unit_cost::float AS "realUnitCost", o.variance::float AS variance,
  o.notes, o.cancel_reason AS "cancelReason",
  o.created_by AS "createdById", cu.names AS "createdBy", o.created_at AS "createdAt",
  ru.names AS "releasedBy", o.released_at AS "releasedAt", o.started_at AS "startedAt",
  fu.names AS "confirmedBy", o.confirmed_at AS "confirmedAt", clu.names AS "closedBy", o.closed_at AS "closedAt",
  xu.names AS "cancelledBy", o.cancelled_at AS "cancelledAt",
  (SELECT COUNT(*) FROM production_processes pp WHERE pp.production_order_id = o.id)::int AS "processesTotal",
  (SELECT COUNT(*) FROM production_processes pp WHERE pp.production_order_id = o.id AND pp.status = 'done')::int AS "processesDone"
  FROM production_orders o
  JOIN products p ON p.id = o.product_id
  JOIN catalogs_units u ON u.id = p.stock_unit_id
  JOIN formulas f ON f.id = o.formula_id
  LEFT JOIN routes r ON r.id = o.route_id
  LEFT JOIN production_centers pc ON pc.id = o.production_center_id
  JOIN warehouses mw ON mw.id = o.materials_warehouse_id
  JOIN warehouses ow ON ow.id = o.output_warehouse_id
  LEFT JOIN lots ol ON ol.id = o.output_lot_id
  LEFT JOIN inventory_movements om ON om.id = o.output_movement_id
  LEFT JOIN users cu ON cu.id = o.created_by
  LEFT JOIN users ru ON ru.id = o.released_by
  LEFT JOIN users fu ON fu.id = o.confirmed_by
  LEFT JOIN users clu ON clu.id = o.closed_by
  LEFT JOIN users xu ON xu.id = o.cancelled_by`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  status: z.enum(["open", "planned", "created", "released", "in_process", "confirmed", "closed", "cancelled"]).optional()
});

export const listOrders = handler({ query: listQuery }, async ({ query: q }) => {
  const rows = await query(
    `${HEADER.replace("SELECT o.id,", "SELECT COUNT(*) OVER()::int AS total_rows, o.id,")}
      WHERE ($1::text IS NULL OR o.number ILIKE '%' || $1 || '%' OR p.code ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%'
             OR o.lot_code ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR ($2::text = 'open' AND o.status IN ('created', 'released', 'in_process', 'confirmed')) OR o.status = $2::text)
      ORDER BY CASE WHEN o.status IN ('closed', 'cancelled') THEN 1 ELSE 0 END, o.priority, o.planned_start, o.number DESC
      LIMIT $3 OFFSET $4`,
    [q.search || null, q.status ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export async function orderDetail(id: string, db?: pg.PoolClient) {
  const header = await one(`${HEADER} WHERE o.id = $1`, [id], db);
  if (!header) throw notFound("Orden de producción no encontrada");
  const lines = await query(
    `SELECT d.id, d.line_no AS "lineNo", d.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
            u.code AS "unitCode", p.is_lot_controlled AS "isLotControlled", d.is_critical AS "isCritical",
            d.warehouse_id AS "warehouseId", w.code AS "warehouseCode", s.code AS "stageCode",
            d.quantity_required::float AS "quantityRequired", d.quantity_consumed::float AS "quantityConsumed",
            COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0)::float AS "quantityReserved",
            COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = d.product_id AND a.warehouse_id = d.warehouse_id), 0)::float AS available,
            d.std_unit_cost::float AS "stdUnitCost", d.consumed_cost::float AS "consumedCost",
            COALESCE((SELECT json_agg(json_build_object('lotId', r.lot_id, 'lotCode', l.lot_code, 'expiresOn', to_char(l.expires_on, 'YYYY-MM-DD'),
                                                        'quantity', r.quantity::float) ORDER BY l.expires_on NULLS LAST, l.lot_code)
                        FROM stock_reservations r LEFT JOIN lots l ON l.id = r.lot_id WHERE r.source_line_id = d.id), '[]') AS reservations
       FROM production_orders_details d
       JOIN products p ON p.id = d.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN stages s ON s.id = d.stage_id
      WHERE d.production_order_id = $1 ORDER BY d.line_no`,
    [id],
    db
  );
  const processes = await query(
    `SELECT pp.id, pp.sequence, pp.status, s.code AS "stageCode", s.name AS "stageName", wc.code AS "workCenterCode", wc.name AS "workCenterName",
            pp.std_hours::float AS "stdHours", pp.real_hours::float AS "realHours", pp.quantity_good::float AS "quantityGood",
            pp.quantity_scrap::float AS "quantityScrap", pp.labor_rate::float AS "laborRate", pp.overhead_rate::float AS "overheadRate",
            pp.started_at AS "startedAt", su.names AS "startedBy", pp.finished_at AS "finishedAt", fu.names AS "finishedBy", pp.notes
       FROM production_processes pp
       JOIN stages s ON s.id = pp.stage_id
       JOIN work_centers wc ON wc.id = pp.work_center_id
       LEFT JOIN users su ON su.id = pp.started_by
       LEFT JOIN users fu ON fu.id = pp.finished_by
      WHERE pp.production_order_id = $1 ORDER BY pp.sequence`,
    [id],
    db
  );
  const movements = await query(
    `SELECT m.id, m.number, m.status, to_char(m.movement_date, 'YYYY-MM-DD') AS "movementDate", c.code AS "conceptCode", c.name AS "conceptName",
            m.direction, w.code AS "warehouseCode", m.total_cost::float AS "totalCost", m.lines, m.reversal_of_id AS "reversalOfId"
       FROM inventory_movements m
       JOIN catalogs_movement_concepts c ON c.id = m.concept_id
       JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.source_module = 'PRODUCTION' AND m.source_document_id = $1 ORDER BY m.created_at`,
    [id],
    db
  );
  return { ...header, lines, processes, movements };
}

export const getOrder = handler({ params: idParams }, ({ params }) => orderDetail(params.id));

// ================================================================== Crear / editar

const orderBody = z.object({
  quantity: z.number().positive().max(1e12),
  plannedStart: z.iso.date(),
  plannedEnd: z.iso.date().nullish(),
  priority: z.number().int().min(1).max(5).default(3),
  productionCenterId: z.uuid().nullish(),
  materialsWarehouseId: z.uuid().nullish(),
  outputWarehouseId: z.uuid().nullish(),
  lotCode: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,40}$/, "Código de lote inválido").nullish(),
  notes: z.string().trim().max(800).nullish()
});

const createBody = orderBody.extend({ productId: z.uuid(), formulaId: z.uuid().nullish() });

interface Resolved {
  productId: string;
  formulaId: string;
  routeId: string | null;
  centerId: string | null;
  materialsWh: string;
  outputWh: string;
}

async function resolveOrder(client: pg.PoolClient, productId: string, formulaId: string | null | undefined, b: z.infer<typeof orderBody>): Promise<Resolved> {
  const p = await one<{ code: string; is_manufactured: boolean; is_active: boolean; is_on_hold: boolean; is_stockable: boolean }>(
    `SELECT code, is_manufactured, is_active, is_on_hold, is_stockable FROM products WHERE id = $1`,
    [productId],
    client
  );
  if (!p) throw badRequest("INVALID_PRODUCT", "Producto inexistente");
  if (!p.is_manufactured || !p.is_stockable) throw badRequest("NOT_MANUFACTURED", `${p.code} no es un producto fabricado inventariable`);
  if (!p.is_active) throw badRequest("INACTIVE_PRODUCT", `${p.code} está inactivo`);
  if (p.is_on_hold) throw badRequest("PRODUCT_ON_HOLD", `${p.code} está retenido`);

  const f = await one<{ id: string; route_id: string | null; center_id: string | null; product_id: string; is_active: boolean }>(
    `SELECT f.id, f.route_id, r.production_center_id AS center_id, f.product_id, f.is_active
       FROM formulas f LEFT JOIN routes r ON r.id = f.route_id
      WHERE ${formulaId ? "f.id = $1" : "f.product_id = $1 AND f.is_default"}`,
    [formulaId ?? productId],
    client
  );
  if (!f) throw badRequest("NO_FORMULA", `${p.code} no tiene fórmula ${formulaId ? "con ese identificador" : "por defecto"}`);
  if (f.product_id !== productId) throw badRequest("FORMULA_MISMATCH", "La fórmula no es del producto indicado");
  if (!f.is_active) throw badRequest("FORMULA_INACTIVE", "La fórmula está inactiva");

  const centerId = b.productionCenterId ?? f.center_id;
  const center = centerId
    ? await one<{ materials_warehouse_id: string | null; output_warehouse_id: string | null; is_active: boolean }>(
        `SELECT materials_warehouse_id, output_warehouse_id, is_active FROM production_centers WHERE id = $1`,
        [centerId],
        client
      )
    : null;
  if (centerId && !center) throw badRequest("INVALID_CENTER", "Centro de producción inexistente");
  const materialsWh = b.materialsWarehouseId ?? center?.materials_warehouse_id;
  const outputWh = b.outputWarehouseId ?? center?.output_warehouse_id;
  if (!materialsWh) throw badRequest("MATERIALS_WAREHOUSE_REQUIRED", "Indique el almacén de materiales");
  if (!outputWh) throw badRequest("OUTPUT_WAREHOUSE_REQUIRED", "Indique el almacén del producto terminado");
  return { productId, formulaId: f.id, routeId: f.route_id, centerId: centerId ?? null, materialsWh, outputWh };
}

/**
 * Copia la fórmula (un nivel) y la ruta a la orden y recalcula el costo estándar.
 * Cada material se consume del almacén de materiales si alcanza; si no, del almacén (dentro del
 * alcance del usuario) con más disponible. Se puede cambiar por línea mientras la orden esté creada.
 */
async function buildLines(client: pg.PoolClient, orderId: string, r: Resolved, quantity: number, scope: string[] | null) {
  await client.query(`DELETE FROM production_orders_details WHERE production_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM production_processes WHERE production_order_id = $1`, [orderId]);

  await client.query(
    `INSERT INTO production_orders_details (production_order_id, line_no, product_id, formula_detail_id, warehouse_id, stage_id,
                                            quantity_required, is_critical, std_unit_cost)
     SELECT $1, x.line_no, x.component_id, x.id,
            COALESCE(CASE WHEN COALESCE((SELECT SUM(a.available) FROM v_stock_available a
                                          WHERE a.product_id = x.component_id AND a.warehouse_id = $3), 0) >= x.required THEN $3::uuid END,
                     (SELECT a.warehouse_id FROM v_stock_available a
                       WHERE a.product_id = x.component_id AND ($5::uuid[] IS NULL OR a.warehouse_id = ANY($5))
                       GROUP BY a.warehouse_id ORDER BY SUM(a.available) DESC LIMIT 1),
                     $3::uuid),
            x.stage_id, x.required, x.is_critical, x.std_cost
       FROM (SELECT d.line_no, d.component_id, d.id, d.stage_id, d.is_critical,
                    round($4::numeric / f.base_quantity * d.quantity * (1 + d.scrap_pct / 100), 6) AS required,
                    round((${stdCostSql("p")})::numeric, 6) AS std_cost
               FROM formulas_details d JOIN formulas f ON f.id = d.formula_id JOIN products p ON p.id = d.component_id
              WHERE d.formula_id = $2) x`,
    [orderId, r.formulaId, r.materialsWh, quantity, scope],
  );
  if (r.routeId) {
    await client.query(
      `INSERT INTO production_processes (production_order_id, sequence, stage_id, work_center_id, std_hours, labor_rate, overhead_rate)
       SELECT $1, d.sequence, d.stage_id, d.work_center_id, round(d.setup_hours + d.run_hours * $3::numeric / r.base_quantity, 4),
              wc.labor_rate, wc.overhead_rate
         FROM routes_data d JOIN routes r ON r.id = d.route_id JOIN work_centers wc ON wc.id = d.work_center_id
        WHERE d.route_id = $2`,
      [orderId, r.routeId, quantity],
    );
  }
  await recomputeStandard(client, orderId);
}

async function recomputeStandard(client: pg.PoolClient, orderId: string) {
  await client.query(
    `UPDATE production_orders o SET
        std_material_cost = COALESCE((SELECT SUM(d.quantity_required * d.std_unit_cost) FROM production_orders_details d WHERE d.production_order_id = o.id), 0),
        std_labor_cost = COALESCE((SELECT SUM(pp.std_hours * pp.labor_rate) FROM production_processes pp WHERE pp.production_order_id = o.id), 0),
        std_overhead_cost = COALESCE((SELECT SUM(pp.std_hours * pp.overhead_rate) FROM production_processes pp WHERE pp.production_order_id = o.id), 0)
      WHERE o.id = $1`,
    [orderId]
  );
}

export const createOrder = handler({ body: createBody }, async ({ body: b, req, res }) => {
  const scope = await warehouseScope(req);
  const id = await withTx(txCtx(req), async (client) => {
    const r = await resolveOrder(client, b.productId, b.formulaId, b);
    assertInScope(scope, r.materialsWh, r.outputWh);
    const o = await one<{ id: string }>(
      `INSERT INTO production_orders (number, status, priority, product_id, formula_id, route_id, production_center_id, materials_warehouse_id,
                                      output_warehouse_id, quantity_planned, planned_start, planned_end, lot_code, notes, created_by, updated_by)
       VALUES (fn_next_document_number('MO'), 'created', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, fn_current_app_user(), fn_current_app_user())
       RETURNING id`,
      [b.priority, r.productId, r.formulaId, r.routeId, r.centerId, r.materialsWh, r.outputWh, b.quantity, b.plannedStart, b.plannedEnd ?? null, b.lotCode ?? null, b.notes ?? null],
      client
    );
    await buildLines(client, o!.id, r, b.quantity, scope);
    return o!.id;
  });
  res.status(201);
  return orderDetail(id);
});

export const updateOrder = handler({ params: idParams, body: orderBody }, async ({ params, body: b, req }) => {
  const scope = await warehouseScope(req);
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["created"], "editar");
    const r = await resolveOrder(client, o.product_id, o.formula_id, b);
    assertInScope(scope, r.materialsWh, r.outputWh);
    await client.query(
      `UPDATE production_orders SET priority = $2, production_center_id = $3, materials_warehouse_id = $4, output_warehouse_id = $5,
              quantity_planned = $6, planned_start = $7, planned_end = $8, lot_code = $9, notes = $10, updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, b.priority, r.centerId, r.materialsWh, r.outputWh, b.quantity, b.plannedStart, b.plannedEnd ?? null, b.lotCode ?? null, b.notes ?? null],
    );
    await buildLines(client, params.id, r, b.quantity, scope);
  });
  return orderDetail(params.id);
});

/** Cambia el almacén del que se consume un material (solo en órdenes creadas) */
export const setLineWarehouse = handler(
  { params: z.object({ id: z.uuid(), lineId: z.uuid() }), body: z.object({ warehouseId: z.uuid() }) },
  async ({ params, body, req }) => {
    const scope = await warehouseScope(req);
    assertInScope(scope, body.warehouseId);
    await withTx(txCtx(req), async (client) => {
      const o = await lockOrder(client, params.id);
      assertStatus(o, ["created"], "cambiar los materiales de");
      const row = await one(
        `UPDATE production_orders_details SET warehouse_id = $3 WHERE id = $2 AND production_order_id = $1 RETURNING id`,
        [params.id, params.lineId, body.warehouseId],
        client
      );
      if (!row) throw notFound("Línea no encontrada");
    });
    return orderDetail(params.id);
  }
);

export const deleteOrder = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["created", "planned"], "eliminar");
    await client.query(`DELETE FROM production_orders WHERE id = $1`, [params.id]);
  });
  return undefined;
});

// ================================================================== Verificar existencia / liberar

interface DetailRow {
  id: string;
  line_no: number;
  product_id: string;
  code: string;
  warehouse_id: string;
  quantity_required: string;
  quantity_consumed: string;
  reserved: string;
  is_critical: boolean;
}

const detailRows = (client: pg.PoolClient, orderId: string) =>
  query<DetailRow>(
    `SELECT d.id, d.line_no, d.product_id, p.code, d.warehouse_id, d.quantity_required, d.quantity_consumed, d.is_critical,
            COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0) AS reserved
       FROM production_orders_details d JOIN products p ON p.id = d.product_id
      WHERE d.production_order_id = $1 ORDER BY d.line_no FOR UPDATE OF d`,
    [orderId],
    client
  );

/** Lotes disponibles de un producto en un almacén, en orden FEFO (el trigger de reservas y el motor revalidan con bloqueo) */
const fefo = (client: pg.PoolClient, warehouseId: string, productId: string) =>
  query<{ lot_id: string | null; available: string }>(
    `SELECT a.lot_id, a.available FROM v_stock_available a
      WHERE a.warehouse_id = $1 AND a.product_id = $2
      ORDER BY a.expires_on NULLS LAST, a.lot_code NULLS FIRST`,
    [warehouseId, productId],
    client
  );

export interface Shortage {
  lineNo: number;
  productCode: string;
  required: number;
  available: number;
  shortfall: number;
  isCritical: boolean;
}

export const releaseOrder = handler({ params: idParams }, async ({ params, req }) => {
  const scope = await warehouseScope(req);
  const shortages = await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["created", "planned"], "liberar");
    const lines = await detailRows(client, params.id);
    if (lines.length === 0) throw conflict("NO_MATERIALS", "La orden no tiene materiales");
    assertInScope(scope, o.output_warehouse_id, ...lines.map((l) => l.warehouse_id));

    const found: Shortage[] = [];
    for (const l of lines) {
      let need = round6(Number(l.quantity_required) - Number(l.quantity_consumed) - Number(l.reserved));
      const required = need;
      for (const lot of need > EPS ? await fefo(client, l.warehouse_id, l.product_id) : []) {
        const take = round6(Math.min(Number(lot.available), need));
        if (take <= EPS) continue;
        await client.query(
          `INSERT INTO stock_reservations (warehouse_id, product_id, lot_id, quantity, source_module, source_document_id, source_line_id, created_by)
           VALUES ($1, $2, $3, $4, 'PRODUCTION', $5, $6, fn_current_app_user())
           ON CONFLICT (source_line_id, warehouse_id, lot_id) DO UPDATE SET quantity = stock_reservations.quantity + EXCLUDED.quantity`,
          [l.warehouse_id, l.product_id, lot.lot_id, take, params.id, l.id],
        );
        need = round6(need - take);
        if (need <= EPS) break;
      }
      if (need > EPS) {
        found.push({ lineNo: l.line_no, productCode: l.code, required, available: round6(required - need), shortfall: need, isCritical: l.is_critical });
      }
    }

    const critical = found.filter((s) => s.isCritical);
    if (critical.length) {
      // Se revierte toda la reserva: la orden sigue creada.
      throw new HttpError(
        409,
        "CRITICAL_SHORTAGE",
        `No se puede liberar: falta ${critical.map((s) => `${s.productCode} (${s.shortfall})`).join(", ")}, que ${critical.length === 1 ? "es crítico" : "son críticos"}`,
        found
      );
    }

    // El estándar se fija con los costos vigentes al liberar.
    await client.query(
      `UPDATE production_orders_details d SET std_unit_cost = round((${stdCostSql("p")})::numeric, 6)
         FROM products p WHERE p.id = d.product_id AND d.production_order_id = $1`,
      [params.id]
    );
    await recomputeStandard(client, params.id);
    await client.query(
      `UPDATE production_orders SET status = 'released', released_by = fn_current_app_user(), released_at = NOW(), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id]
    );
    return found;
  });
  return { ...(await orderDetail(params.id)), shortages };
});

/** Devuelve una orden liberada a creada (suelta las reservas) mientras no se haya consumido ni iniciado nada */
export const unreleaseOrder = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["released"], "devolver a creada");
    await client.query(`DELETE FROM stock_reservations WHERE source_document_id = $1`, [params.id]);
    await client.query(
      `UPDATE production_orders SET status = 'created', released_by = NULL, released_at = NULL, updated_by = fn_current_app_user() WHERE id = $1`,
      [params.id]
    );
  });
  return orderDetail(params.id);
});

/** Verificar existencia: requerido vs. disponible por material (sin reservar nada) */
export const availability = handler({ params: idParams }, async ({ params }) => {
  const rows = await query<{ pending: number; available: number; availableElsewhere: number; isCritical: boolean }>(
    `SELECT d.id, d.line_no AS "lineNo", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode", w.code AS "warehouseCode",
            d.is_critical AS "isCritical", d.quantity_required::float AS required, d.quantity_consumed::float AS consumed,
            COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0)::float AS reserved,
            GREATEST(d.quantity_required - d.quantity_consumed - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0), 0)::float AS pending,
            COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = d.product_id AND a.warehouse_id = d.warehouse_id), 0)::float AS available,
            COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = d.product_id AND a.warehouse_id <> d.warehouse_id), 0)::float AS "availableElsewhere"
       FROM production_orders_details d
       JOIN products p ON p.id = d.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       JOIN warehouses w ON w.id = d.warehouse_id
      WHERE d.production_order_id = $1 ORDER BY d.line_no`,
    [params.id]
  );
  const items = rows.map((r) => ({ ...r, shortfall: Math.max(0, round6(r.pending - r.available)) }));
  return {
    items,
    canRelease: !items.some((i) => i.isCritical && i.shortfall > 0),
    shortages: items.filter((i) => i.shortfall > 0).length
  };
});

// ================================================================== Consumir materiales

const consumeBody = z.object({
  movementDate: z.iso.date().optional(),
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity: z.number().positive().max(1e12) }))
    .max(200)
    .optional()
});

interface Pick {
  lineId: string;
  warehouseId: string;
  productId: string;
  lotId: string | null;
  quantity: number;
}

async function markStarted(client: pg.PoolClient, orderId: string) {
  await client.query(
    `UPDATE production_orders SET status = 'in_process', started_at = COALESCE(started_at, NOW()), updated_by = fn_current_app_user()
      WHERE id = $1 AND status = 'released'`,
    [orderId]
  );
}

export const consumeMaterials = handler({ params: idParams, body: consumeBody }, async ({ params, body: b, req }) => {
  const scope = await warehouseScope(req);
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["released", "in_process"], "consumir materiales de");
    if (b.movementDate) {
      const f = await one<{ f: boolean }>(`SELECT $1::date > CURRENT_DATE AS f`, [b.movementDate], client);
      if (f?.f) throw badRequest("FUTURE_DATE", "La fecha no puede ser futura");
    }
    const lines = await detailRows(client, params.id);
    const byId = new Map(lines.map((l) => [l.id, l]));

    // Qué consumir: lo pedido, o por defecto todo lo reservado.
    const requests = b.lines?.length
      ? b.lines.map((r) => {
          const l = byId.get(r.lineId);
          if (!l) throw badRequest("INVALID_LINE", "Una línea no pertenece a la orden");
          return { line: l, quantity: r.quantity };
        })
      : lines.filter((l) => Number(l.reserved) > EPS).map((l) => ({ line: l, quantity: Number(l.reserved) }));
    if (requests.length === 0) throw badRequest("NOTHING_TO_CONSUME", "No hay materiales reservados pendientes por consumir");
    if (new Set(requests.map((r) => r.line.id)).size !== requests.length) throw badRequest("DUPLICATED_LINE", "Una línea aparece dos veces");
    assertInScope(scope, ...requests.map((r) => r.line.warehouse_id));

    const picks: Pick[] = [];
    const taken = new Map<string, number>(); // almacén|lote → ya tomado de lo libre en esta operación
    for (const { line, quantity } of requests) {
      let need = round6(quantity);
      const reservations = await query<{ id: string; lot_id: string | null; quantity: string }>(
        `SELECT r.id, r.lot_id, r.quantity FROM stock_reservations r LEFT JOIN lots l ON l.id = r.lot_id
          WHERE r.source_line_id = $1 ORDER BY l.expires_on NULLS LAST, l.lot_code NULLS FIRST FOR UPDATE OF r`,
        [line.id],
        client
      );
      for (const r of reservations) {
        if (need <= EPS) break;
        const take = round6(Math.min(Number(r.quantity), need));
        const left = round6(Number(r.quantity) - take);
        if (left > EPS) await client.query(`UPDATE stock_reservations SET quantity = $2 WHERE id = $1`, [r.id, left]);
        else await client.query(`DELETE FROM stock_reservations WHERE id = $1`, [r.id]);
        picks.push({ lineId: line.id, warehouseId: line.warehouse_id, productId: line.product_id, lotId: r.lot_id, quantity: take });
        need = round6(need - take);
      }
      if (need > EPS) {
        // Lo que exceda la reserva sale de lo libre (FEFO); lo recién des-reservado no cuenta como libre.
        for (const lot of await fefo(client, line.warehouse_id, line.product_id)) {
          const key = `${line.warehouse_id}|${lot.lot_id ?? ""}`;
          const releasedHere = picks
            .filter((p) => p.warehouseId === line.warehouse_id && p.productId === line.product_id && p.lotId === lot.lot_id)
            .reduce((a, p) => a + p.quantity, 0);
          const free = round6(Number(lot.available) - releasedHere - (taken.get(key) ?? 0));
          const take = round6(Math.min(free, need));
          if (take <= EPS) continue;
          picks.push({ lineId: line.id, warehouseId: line.warehouse_id, productId: line.product_id, lotId: lot.lot_id, quantity: take });
          taken.set(key, (taken.get(key) ?? 0) + take);
          need = round6(need - take);
          if (need <= EPS) break;
        }
      }
      if (need > EPS) {
        throw conflict("INSUFFICIENT_STOCK", `Línea ${line.line_no} (${line.code}): faltan ${need} para consumir lo indicado`);
      }
    }

    // Una salida CONS_PROD por almacén; el motor de inventario valúa al promedio ponderado.
    const concept = await conceptId(client, "CONS_PROD");
    const byWarehouse = new Map<string, Pick[]>();
    for (const p of picks) byWarehouse.set(p.warehouseId, [...(byWarehouse.get(p.warehouseId) ?? []), p]);
    for (const [warehouseId, group] of byWarehouse) {
      const mv = await one<{ id: string }>(
        `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes, source_module, source_document_id, created_by)
         VALUES (fn_next_document_number('MOV'), COALESCE($1::date, CURRENT_DATE), $2, 'out', $3, $4, $5, 'PRODUCTION', $6, fn_current_app_user()) RETURNING id`,
        [b.movementDate ?? null, concept.id, warehouseId, o.number, `Consumo de materiales ${o.number}`, params.id],
        client
      );
      for (const [i, p] of group.entries()) {
        await client.query(
          `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
          [mv!.id, i + 1, p.productId, p.lotId, p.quantity],
        );
      }
      await client.query(`SELECT fn_post_inventory_movement($1)`, [mv!.id]);
      // Costo real de cada material: el que fijó el motor en cada línea del movimiento (line_no = posición en group).
      const posted = await query<{ line_no: number; total_cost: string }>(
        `SELECT line_no, total_cost FROM inventory_movements_details WHERE movement_id = $1`,
        [mv!.id],
        client
      );
      const perLine = new Map<string, { qty: number; cost: number }>();
      for (const d of posted) {
        const p = group[d.line_no - 1];
        const acc = perLine.get(p.lineId) ?? { qty: 0, cost: 0 };
        perLine.set(p.lineId, { qty: acc.qty + p.quantity, cost: acc.cost + Number(d.total_cost) });
      }
      for (const [lineId, x] of perLine) {
        await client.query(
          `UPDATE production_orders_details SET quantity_consumed = quantity_consumed + $2, consumed_cost = consumed_cost + $3 WHERE id = $1`,
          [lineId, round6(x.qty), x.cost]
        );
      }
    }
    await markStarted(client, params.id);
  });
  return orderDetail(params.id);
});

// ================================================================== Confirmar lo fabricado

const confirmBody = z.object({
  quantity: z.number().positive().max(1e12),
  lotCode: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,40}$/, "Código de lote inválido").nullish(),
  manufacturedOn: z.iso.date().optional(),
  expiresOn: z.iso.date().nullish(),
  notes: z.string().trim().max(800).nullish()
});

export const confirmOrder = handler({ params: idParams, body: confirmBody }, async ({ params, body: b, req }) => {
  const scope = await warehouseScope(req);
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["in_process"], "confirmar");
    assertInScope(scope, o.output_warehouse_id);

    const pending = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM production_processes WHERE production_order_id = $1 AND status <> 'done'`,
      [params.id],
      client
    );
    if (pending!.n > 0) throw conflict("PROCESSES_PENDING", `Faltan ${pending!.n} etapa(s) por terminar en Seguimiento`);
    const consumed = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM production_orders_details WHERE production_order_id = $1 AND quantity_consumed > 0`,
      [params.id],
      client
    );
    if (consumed!.n === 0) throw conflict("NOTHING_CONSUMED", "No se ha consumido ningún material");

    const p = await one<{ code: string; is_lot_controlled: boolean; shelf_life_days: number | null }>(
      `SELECT code, is_lot_controlled, shelf_life_days FROM products WHERE id = $1`,
      [o.product_id],
      client
    );
    const lotCode = b.lotCode ?? o.lot_code;
    if (p!.is_lot_controlled && !lotCode) throw badRequest("LOT_REQUIRED", `${p!.code} se maneja por lote; indique el código del lote`);
    if (p!.is_lot_controlled && (await one(`SELECT 1 FROM lots WHERE product_id = $1 AND lot_code = $2`, [o.product_id, lotCode], client))) {
      throw conflict("LOT_EXISTS", `El lote ${lotCode} de ${p!.code} ya existe`);
    }

    // Costo real: materiales consumidos + horas reales × tarifas de cada etapa.
    const cost = (await one<{ material: string; labor: string; overhead: string }>(
      `SELECT COALESCE((SELECT SUM(consumed_cost) FROM production_orders_details WHERE production_order_id = $1), 0) AS material,
              COALESCE((SELECT SUM(real_hours * labor_rate) FROM production_processes WHERE production_order_id = $1), 0) AS labor,
              COALESCE((SELECT SUM(real_hours * overhead_rate) FROM production_processes WHERE production_order_id = $1), 0) AS overhead`,
      [params.id],
      client
    ))!;
    const total = Number(cost.material) + Number(cost.labor) + Number(cost.overhead);
    const unitCost = round6(total / b.quantity);

    const concept = await conceptId(client, "ENT_PROD");
    const mv = await one<{ id: string }>(
      `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes, source_module, source_document_id, created_by)
       VALUES (fn_next_document_number('MOV'), CURRENT_DATE, $1, 'in', $2, $3, $4, 'PRODUCTION', $5, fn_current_app_user()) RETURNING id`,
      [concept.id, o.output_warehouse_id, o.number, `Producto fabricado ${o.number}`, params.id],
      client
    );

    let lotId: string | null = null;
    if (p!.is_lot_controlled) {
      const quarantine = (await one<{ v: boolean }>(
        `SELECT COALESCE((fn_parameter('QUALITY', 'quarantine_on_production'))::text::boolean, TRUE) AS v`,
        [],
        client
      ))!.v;
      const lot = await one<{ id: string }>(
        `INSERT INTO lots (product_id, lot_code, manufactured_on, expires_on, received_on, quality_status, unit_cost, origin_movement_id,
                           production_order_id, created_by, updated_by)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE),
                 COALESCE($4::date, CASE WHEN $5::int IS NOT NULL THEN COALESCE($3::date, CURRENT_DATE) + $5::int END),
                 CURRENT_DATE, $6, $7, $8, $9, fn_current_app_user(), fn_current_app_user())
         RETURNING id`,
        [o.product_id, lotCode, b.manufacturedOn ?? null, b.expiresOn ?? null, p!.shelf_life_days, quarantine ? concept.lot_status_on_entry : "approved", unitCost, mv!.id, params.id],
        client
      );
      lotId = lot!.id;
    }
    await client.query(
      `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost) VALUES ($1, 1, $2, $3, $4, $5)`,
      [mv!.id, o.product_id, lotId, b.quantity, unitCost],
    );
    await client.query(`SELECT fn_post_inventory_movement($1)`, [mv!.id]);

    await client.query(
      `UPDATE production_orders SET status = 'confirmed', quantity_produced = $2, lot_code = $3, output_lot_id = $4, output_movement_id = $5,
              real_material_cost = $6, real_labor_cost = $7, real_overhead_cost = $8, real_unit_cost = $9,
              notes = COALESCE($10, notes), confirmed_by = fn_current_app_user(), confirmed_at = NOW(), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, b.quantity, lotCode ?? null, lotId, mv!.id, cost.material, cost.labor, cost.overhead, unitCost, b.notes ?? null],
    );
  });
  return orderDetail(params.id);
});

// ================================================================== Cerrar / anular

export const closeOrder = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const o = await lockOrder(client, params.id);
    assertStatus(o, ["confirmed"], "cerrar");
    await client.query(`DELETE FROM stock_reservations WHERE source_document_id = $1`, [params.id]);
    // Variación = real − estándar de lo efectivamente fabricado (positivo = desfavorable).
    await client.query(
      `UPDATE production_orders SET status = 'closed', closed_by = fn_current_app_user(), closed_at = NOW(), updated_by = fn_current_app_user(),
              variance = round(COALESCE(real_material_cost, 0) + COALESCE(real_labor_cost, 0) + COALESCE(real_overhead_cost, 0)
                         - (std_material_cost + std_labor_cost + std_overhead_cost) / quantity_planned * quantity_produced, 6)
        WHERE id = $1`,
      [params.id]
    );
  });
  return orderDetail(params.id);
});

export const cancelOrder = handler(
  { params: idParams, body: z.object({ reason: z.string().trim().min(3, "Indique el motivo").max(400) }) },
  async ({ params, body, req }) => {
    await withTx(txCtx(req), async (client) => {
      const o = await lockOrder(client, params.id);
      assertStatus(o, ["planned", "created", "released"], "anular");
      const started = await one(
        `SELECT 1 FROM production_processes WHERE production_order_id = $1 AND status <> 'pending'
         UNION ALL SELECT 1 FROM production_orders_details WHERE production_order_id = $1 AND quantity_consumed > 0 LIMIT 1`,
        [params.id],
        client
      );
      if (started) throw conflict("ALREADY_STARTED", "La orden ya tiene consumos o etapas iniciadas: debe confirmarse y cerrarse");
      await client.query(`DELETE FROM stock_reservations WHERE source_document_id = $1`, [params.id]);
      await client.query(
        `UPDATE production_orders SET status = 'cancelled', cancel_reason = $2, cancelled_by = fn_current_app_user(), cancelled_at = NOW(),
                updated_by = fn_current_app_user() WHERE id = $1`,
        [params.id, body.reason]
      );
    });
    return orderDetail(params.id);
  }
);
