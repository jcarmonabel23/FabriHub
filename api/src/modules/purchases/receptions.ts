/**
 * @project FabriHub - API
 * @file src/modules/purchases/receptions.ts
 * @description Recepciones, anulaciones y devoluciones a proveedor (PUR_RECEPTIONS) — tesis: Clase Recepción
 *
 * @overview
 * Recibir (tesis: método Recibir → Generar Transacción + Recalcular Costos + Cambiar Estado):
 *  1. Valida la orden (aprobada o con recepción parcial) y la tolerancia de sobre-recepción.
 *  2. Crea los lotes nuevos, en CUARENTENA si QUALITY.quarantine_on_receipt (y con el receptor
 *     como creador: luego no podrá liberarlos en Calidad).
 *  3. Genera un movimiento REC_COMPRA y lo contabiliza con el motor de inventario: el costo entra
 *     en moneda base (precio neto × tasa del día de recepción ÷ factor de unidad).
 *  4. Suma lo recibido a cada línea y recalcula el estado: parcial (BackOrder) o recibida.
 *
 * Anular una recepción reversa su movimiento (falla si ya se consumió). Devolver al proveedor
 * genera una salida DEV_PROV (permite lotes rechazados) y descuenta lo recibido.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "../inventory/scope.js";
import { exchangeRate } from "./fiscal.js";
import { orderDetail } from "./orders.js";

async function recomputeOrderStatus(client: pg.PoolClient, poId: string) {
  await client.query(
    `UPDATE purchase_orders po
        SET status = CASE
              WHEN NOT EXISTS (SELECT 1 FROM purchase_orders_details d WHERE d.purchase_order_id = po.id AND d.quantity_received < d.quantity) THEN 'received'
              WHEN EXISTS (SELECT 1 FROM purchase_orders_details d WHERE d.purchase_order_id = po.id AND d.quantity_received > 0) THEN 'partially_received'
              ELSE 'approved' END,
            updated_by = fn_current_app_user()
      WHERE po.id = $1 AND po.status IN ('approved', 'partially_received', 'received')`,
    [poId]
  );
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

async function assertNotFuture(client: pg.PoolClient, date: string) {
  const f = await one<{ f: boolean }>(`SELECT $1::date > CURRENT_DATE AS f`, [date], client);
  if (f?.f) throw badRequest("FUTURE_DATE", "La fecha no puede ser futura");
}

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT r.id, r.number, r.kind, r.status, to_char(r.reception_date, 'YYYY-MM-DD') AS "receptionDate",
  r.delivery_note AS "deliveryNote", r.exchange_rate::float AS "exchangeRate", r.notes,
  r.purchase_order_id AS "purchaseOrderId", po.number AS "orderNumber", po.status AS "orderStatus",
  s.id AS "supplierId", s.legal_name AS "supplierName", w.id AS "warehouseId", w.code AS "warehouseCode",
  r.movement_id AS "movementId", m.number AS "movementNumber", cur.code AS "currencyCode",
  r.returned_reception_id AS "returnedReceptionId", rr.number AS "returnedReceptionNumber",
  u.names AS "createdBy", r.created_at AS "createdAt", cu.names AS "cancelledBy", r.cancelled_at AS "cancelledAt",
  (SELECT COALESCE(SUM(rd.stock_quantity * rd.unit_cost), 0) FROM receptions_details rd WHERE rd.reception_id = r.id)::float AS "totalCost"
  FROM receptions r
  JOIN purchase_orders po ON po.id = r.purchase_order_id
  JOIN suppliers s ON s.id = po.supplier_id
  JOIN catalogs_currencies cur ON cur.id = po.currency_id
  JOIN warehouses w ON w.id = r.warehouse_id
  LEFT JOIN inventory_movements m ON m.id = r.movement_id
  LEFT JOIN receptions rr ON rr.id = r.returned_reception_id
  LEFT JOIN users u ON u.id = r.created_by
  LEFT JOIN users cu ON cu.id = r.cancelled_by`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  kind: z.enum(["receipt", "return"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listReceptions = handler({ query: listQuery }, async ({ query: q, req }) => {
  const scope = await warehouseScope(req);
  const rows = await query(
    `${HEADER.replace("SELECT r.id,", "SELECT COUNT(*) OVER()::int AS total_rows, r.id,")}
      WHERE ($1::uuid[] IS NULL OR r.warehouse_id = ANY($1))
        AND ($2::text IS NULL OR r.number ILIKE '%' || $2 || '%' OR po.number ILIKE '%' || $2 || '%'
             OR r.delivery_note ILIKE '%' || $2 || '%' OR s.legal_name ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR r.kind = $3)
        AND ($4::date IS NULL OR r.reception_date >= $4)
        AND ($5::date IS NULL OR r.reception_date <= $5)
      ORDER BY r.created_at DESC LIMIT $6 OFFSET $7`,
    [scope, q.search || null, q.kind ?? null, q.from ?? null, q.to ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function receptionDetail(id: string, scope: string[] | null) {
  const header = await one<{ warehouseId: string }>(`${HEADER} WHERE r.id = $1`, [id]);
  if (!header || (scope && !scope.includes(header.warehouseId))) throw notFound("Recepción no encontrada");
  const lines = await query(
    `SELECT rd.id, rd.line_no AS "lineNo", rd.po_line_id AS "poLineId", p.code AS "productCode", p.name AS "productName",
            u.code AS "unitCode", su.code AS "stockUnitCode", rd.quantity::float AS quantity, rd.stock_quantity::float AS "stockQuantity",
            rd.unit_cost::float AS "unitCost", rd.lot_id AS "lotId", l.lot_code AS "lotCode", l.quality_status AS "lotStatus",
            to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn", rd.supplier_lot AS "supplierLot",
            (SELECT COALESCE(SUM(x.quantity), 0) FROM receptions_details x JOIN receptions xr ON xr.id = x.reception_id
              WHERE xr.returned_reception_id = rd.reception_id AND xr.status = 'posted'
                AND x.po_line_id = rd.po_line_id AND x.lot_id IS NOT DISTINCT FROM rd.lot_id)::float AS returned
       FROM receptions_details rd
       JOIN products p ON p.id = rd.product_id
       JOIN catalogs_units su ON su.id = p.stock_unit_id
       JOIN purchase_orders_details d ON d.id = rd.po_line_id
       JOIN catalogs_units u ON u.id = d.unit_id
       LEFT JOIN lots l ON l.id = rd.lot_id
      WHERE rd.reception_id = $1 ORDER BY rd.line_no`,
    [id]
  );
  return { ...header, lines };
}

export const getReception = handler({ params: idParams }, async ({ params, req }) => receptionDetail(params.id, await warehouseScope(req)));

/** Órdenes con pendientes por recibir en los almacenes del usuario */
export const pendingOrders = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  return query(
    `SELECT po.id, po.number, po.status, to_char(po.order_date, 'YYYY-MM-DD') AS "orderDate",
            to_char(po.expected_date, 'YYYY-MM-DD') AS "expectedDate", s.legal_name AS "supplierName", w.code AS "warehouseCode",
            (SELECT COUNT(*) FROM purchase_orders_details d WHERE d.purchase_order_id = po.id AND d.quantity_received < d.quantity)::int AS "pendingLines"
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN warehouses w ON w.id = po.warehouse_id
      WHERE po.status IN ('approved', 'partially_received') AND ($1::uuid[] IS NULL OR po.warehouse_id = ANY($1))
      ORDER BY po.expected_date NULLS LAST, po.number`,
    [scope]
  );
});

/** La orden vista desde Recepciones (quien recibe no necesita acceso a Órdenes de compra) */
export const orderForReception = handler({ params: idParams }, async ({ params, req }) => {
  const po = await one<{ warehouse_id: string }>(`SELECT warehouse_id FROM purchase_orders WHERE id = $1`, [params.id]);
  if (!po) throw notFound("Orden de compra no encontrada");
  assertInScope(await warehouseScope(req), po.warehouse_id);
  return orderDetail(params.id);
});

// ------------------------------------------------------------------ Recibir

const receiveBody = z.object({
  receptionDate: z.iso.date(),
  deliveryNote: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(800).nullish(),
  lines: z
    .array(
      z.object({
        poLineId: z.uuid(),
        quantity: z.number().positive().max(1e12),
        lotCode: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,40}$/, "Código de lote inválido").nullish(),
        expiresOn: z.iso.date().nullish(),
        manufacturedOn: z.iso.date().nullish(),
        supplierLot: z.string().trim().max(40).nullish()
      })
    )
    .min(1, "Indique al menos una línea a recibir")
    .max(200)
});

interface PoLine {
  id: string;
  line_no: number;
  product_id: string;
  code: string;
  is_stockable: boolean;
  is_lot_controlled: boolean;
  shelf_life_days: number | null;
  unit_factor: string;
  quantity: string;
  quantity_received: string;
  unit_price: string;
  discount_pct: string;
}

export const receiveOrder = handler({ params: idParams, body: receiveBody }, async ({ params, body: b, req, res }) => {
  const scope = await warehouseScope(req);
  const receptionId = await withTx(txCtx(req), async (client) => {
    const po = await one<{ number: string; status: string; supplier_id: string; warehouse_id: string; currency_id: string; discount_pct: string }>(
      `SELECT number, status, supplier_id, warehouse_id, currency_id, discount_pct FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!po) throw notFound("Orden de compra no encontrada");
    if (!["approved", "partially_received"].includes(po.status)) {
      throw conflict("INVALID_STATUS", `La orden ${po.number} no está aprobada para recibir`);
    }
    assertInScope(scope, po.warehouse_id);
    await assertNotFuture(client, b.receptionDate);

    const ids = b.lines.map((l) => l.poLineId);
    if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATED_LINE", "Una línea de la orden aparece dos veces");
    const poLines = new Map(
      (
        await query<PoLine>(
          `SELECT d.id, d.line_no, d.product_id, p.code, p.is_stockable, p.is_lot_controlled, p.shelf_life_days,
                  d.unit_factor, d.quantity, d.quantity_received, d.unit_price, d.discount_pct
             FROM purchase_orders_details d JOIN products p ON p.id = d.product_id
            WHERE d.purchase_order_id = $1 AND d.id = ANY($2) FOR UPDATE OF d`,
          [params.id, ids],
          client
        )
      ).map((l) => [l.id, l])
    );

    const tolerance = Number(
      (await one<{ v: string }>(`SELECT COALESCE(fn_parameter('PURCHASES', 'receipt_tolerance_pct'), '0')::text AS v`, [], client))!.v
    );
    const quarantine = (await one<{ v: boolean }>(
      `SELECT COALESCE((fn_parameter('QUALITY', 'quarantine_on_receipt'))::text::boolean, TRUE) AS v`,
      [],
      client
    ))!.v;
    const rate = await exchangeRate(client, po.currency_id, b.receptionDate);
    const concept = await conceptId(client, "REC_COMPRA");

    const rec = await one<{ id: string; number: string }>(
      `INSERT INTO receptions (number, kind, purchase_order_id, reception_date, warehouse_id, delivery_note, exchange_rate, notes, created_by)
       VALUES (fn_next_document_number('REC'), 'receipt', $1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id, number`,
      [params.id, b.receptionDate, po.warehouse_id, b.deliveryNote ?? null, rate, b.notes ?? null],
      client
    );

    let movementId: string | null = null;
    let movLine = 0;
    for (const [i, l] of b.lines.entries()) {
      const n = i + 1;
      const d = poLines.get(l.poLineId);
      if (!d) throw badRequest("INVALID_LINE", `Línea ${n}: no pertenece a la orden`);
      const ordered = Number(d.quantity);
      const max = ordered * (1 + tolerance / 100) - Number(d.quantity_received);
      if (l.quantity > max + 1e-9) {
        throw badRequest(
          "OVER_RECEIPT",
          `Línea ${d.line_no} (${d.code}): recibiría más de lo pedido. Máximo admitido con tolerancia ${tolerance}%: ${Math.max(0, Math.round(max * 1e6) / 1e6)}`
        );
      }
      const factor = Number(d.unit_factor);
      const stockQty = l.quantity * factor;
      const net = Number(d.unit_price) * (1 - Number(d.discount_pct) / 100) * (1 - Number(po.discount_pct) / 100);
      const unitCost = Math.round(((net * rate) / factor) * 1e6) / 1e6;

      let lotId: string | null = null;
      if (d.is_stockable) {
        if (!movementId) {
          const mv = await one<{ id: string }>(
            `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes,
                                              source_module, source_document_id, created_by)
             VALUES (fn_next_document_number('MOV'), $1, $2, 'in', $3, $4, $5, 'PURCHASES', $6, fn_current_app_user()) RETURNING id`,
            [b.receptionDate, concept.id, po.warehouse_id, po.number, `Recepción ${rec!.number}`, rec!.id],
            client
          );
          movementId = mv!.id;
        }
        if (d.is_lot_controlled) {
          if (!l.lotCode) throw badRequest("LOT_REQUIRED", `Línea ${d.line_no}: ${d.code} se maneja por lote; indique el lote`);
          const exists = await one(`SELECT 1 FROM lots WHERE product_id = $1 AND lot_code = $2`, [d.product_id, l.lotCode], client);
          if (exists) throw conflict("LOT_EXISTS", `Línea ${d.line_no}: el lote ${l.lotCode} de ${d.code} ya existe`);
          const lot = await one<{ id: string }>(
            `INSERT INTO lots (product_id, lot_code, manufactured_on, expires_on, received_on, supplier_lot, quality_status, unit_cost,
                               origin_movement_id, supplier_id, purchase_order_id, created_by, updated_by)
             VALUES ($1, $2, $3, COALESCE($4::date, CASE WHEN $5::int IS NOT NULL THEN COALESCE($3::date, $6::date) + $5::int END),
                     $6, $7, $8, $9, $10, $11, $12, fn_current_app_user(), fn_current_app_user())
             RETURNING id`,
            [
              d.product_id,
              l.lotCode,
              l.manufacturedOn ?? null,
              l.expiresOn ?? null,
              d.shelf_life_days,
              b.receptionDate,
              l.supplierLot ?? null,
              quarantine ? concept.lot_status_on_entry : "approved",
              unitCost,
              movementId,
              po.supplier_id,
              params.id
            ],
            client
          );
          lotId = lot!.id;
        } else if (l.lotCode) {
          throw badRequest("LOT_NOT_ALLOWED", `Línea ${d.line_no}: ${d.code} no se maneja por lote`);
        }
        movLine += 1;
        await client.query(
          `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [movementId, movLine, d.product_id, lotId, stockQty, unitCost]
        );
      }

      await client.query(
        `INSERT INTO receptions_details (reception_id, line_no, po_line_id, product_id, quantity, stock_quantity, unit_cost, lot_id, supplier_lot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rec!.id, n, d.id, d.product_id, l.quantity, stockQty, unitCost, lotId, l.supplierLot ?? null]
      );
      await client.query(`UPDATE purchase_orders_details SET quantity_received = quantity_received + $2 WHERE id = $1`, [d.id, l.quantity]);
    }

    if (movementId) {
      await client.query(`SELECT fn_post_inventory_movement($1)`, [movementId]);
      await client.query(`UPDATE receptions SET movement_id = $2 WHERE id = $1`, [rec!.id, movementId]);
    }
    await recomputeOrderStatus(client, params.id);
    return rec!.id;
  });
  res.status(201);
  return receptionDetail(receptionId, scope);
});

// ------------------------------------------------------------------ Anular recepción

export const cancelReception = handler(
  { params: idParams, body: z.object({ reason: z.string().trim().min(3).max(400) }) },
  async ({ params, body, req }) => {
    const scope = await warehouseScope(req);
    await withTx(txCtx(req), async (client) => {
      const r = await one<{ kind: string; status: string; purchase_order_id: string; movement_id: string | null; warehouse_id: string; number: string }>(
        `SELECT kind, status, purchase_order_id, movement_id, warehouse_id, number FROM receptions WHERE id = $1 FOR UPDATE`,
        [params.id],
        client
      );
      if (!r) throw notFound("Recepción no encontrada");
      assertInScope(scope, r.warehouse_id);
      if (r.status !== "posted") throw conflict("ALREADY_CANCELLED", `La ${r.kind === "return" ? "devolución" : "recepción"} ${r.number} ya está anulada`);
      const po = await one<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = $1 FOR UPDATE`, [r.purchase_order_id], client);
      if (po?.status === "closed") throw conflict("ORDER_CLOSED", "La orden está cerrada: registre una devolución en su lugar");
      if (r.kind === "receipt") {
        const returned = await one(`SELECT 1 FROM receptions WHERE returned_reception_id = $1 AND status = 'posted'`, [params.id], client);
        if (returned) throw conflict("HAS_RETURNS", "La recepción tiene devoluciones: anúlelas primero");
      }
      // Si ya se consumió (o se trasladó) parte de lo recibido, el reverso falla con "Existencia insuficiente".
      if (r.movement_id) await client.query(`SELECT fn_reverse_inventory_movement($1)`, [r.movement_id]);

      const sign = r.kind === "receipt" ? -1 : 1;
      await client.query(
        `UPDATE purchase_orders_details d SET quantity_received = d.quantity_received + $2 * x.qty
           FROM (SELECT po_line_id, SUM(quantity) AS qty FROM receptions_details WHERE reception_id = $1 GROUP BY po_line_id) x
          WHERE d.id = x.po_line_id`,
        [params.id, sign]
      );
      await client.query(
        `UPDATE receptions SET status = 'cancelled', cancelled_by = fn_current_app_user(), cancelled_at = NOW(),
                notes = concat_ws(E'\\n', notes, 'Anulada: ' || $2) WHERE id = $1`,
        [params.id, body.reason]
      );
      await recomputeOrderStatus(client, r.purchase_order_id);
    });
    return receptionDetail(params.id, scope);
  }
);

// ------------------------------------------------------------------ Devolución al proveedor

const returnBody = z.object({
  returnDate: z.iso.date(),
  notes: z.string().trim().min(3, "Indique el motivo de la devolución").max(800),
  lines: z.array(z.object({ receptionLineId: z.uuid(), quantity: z.number().positive().max(1e12) })).min(1).max(200)
});

export const returnToSupplier = handler({ params: idParams, body: returnBody }, async ({ params, body: b, req, res }) => {
  const scope = await warehouseScope(req);
  const returnId = await withTx(txCtx(req), async (client) => {
    const r = await one<{ kind: string; status: string; purchase_order_id: string; warehouse_id: string; number: string; exchange_rate: string }>(
      `SELECT kind, status, purchase_order_id, warehouse_id, number, exchange_rate FROM receptions WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!r || r.kind !== "receipt") throw notFound("Recepción no encontrada");
    if (r.status !== "posted") throw conflict("ALREADY_CANCELLED", `La recepción ${r.number} está anulada`);
    assertInScope(scope, r.warehouse_id);
    await assertNotFuture(client, b.returnDate);
    const po = await one<{ status: string; number: string }>(`SELECT status, number FROM purchase_orders WHERE id = $1 FOR UPDATE`, [r.purchase_order_id], client);

    const lines = new Map(
      (
        await query<{ id: string; line_no: number; po_line_id: string; product_id: string; code: string; quantity: string; stock_quantity: string; unit_cost: string; lot_id: string | null; is_stockable: boolean; returned: string }>(
          `SELECT rd.id, rd.line_no, rd.po_line_id, rd.product_id, p.code, rd.quantity, rd.stock_quantity, rd.unit_cost, rd.lot_id, p.is_stockable,
                  (SELECT COALESCE(SUM(x.quantity), 0) FROM receptions_details x JOIN receptions xr ON xr.id = x.reception_id
                    WHERE xr.returned_reception_id = rd.reception_id AND xr.status = 'posted'
                      AND x.po_line_id = rd.po_line_id AND x.lot_id IS NOT DISTINCT FROM rd.lot_id) AS returned
             FROM receptions_details rd JOIN products p ON p.id = rd.product_id
            WHERE rd.reception_id = $1`,
          [params.id],
          client
        )
      ).map((l) => [l.id, l])
    );

    const concept = await conceptId(client, "DEV_PROV");
    const ret = await one<{ id: string; number: string }>(
      `INSERT INTO receptions (number, kind, purchase_order_id, returned_reception_id, reception_date, warehouse_id, exchange_rate, notes, created_by)
       VALUES (fn_next_document_number('REC'), 'return', $1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id, number`,
      [r.purchase_order_id, params.id, b.returnDate, r.warehouse_id, r.exchange_rate, b.notes],
      client
    );

    let movementId: string | null = null;
    let movLine = 0;
    for (const [i, l] of b.lines.entries()) {
      const src = lines.get(l.receptionLineId);
      if (!src) throw badRequest("INVALID_LINE", `Línea ${i + 1}: no pertenece a la recepción ${r.number}`);
      const available = Number(src.quantity) - Number(src.returned);
      if (l.quantity > available + 1e-9) {
        throw badRequest("OVER_RETURN", `Línea ${src.line_no} (${src.code}): se recibió ${Number(src.quantity)} y ya se devolvió ${Number(src.returned)}`);
      }
      const factor = Number(src.stock_quantity) / Number(src.quantity);
      const stockQty = l.quantity * factor;
      if (src.is_stockable) {
        if (!movementId) {
          const mv = await one<{ id: string }>(
            `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes,
                                              source_module, source_document_id, created_by)
             VALUES (fn_next_document_number('MOV'), $1, $2, 'out', $3, $4, $5, 'PURCHASES', $6, fn_current_app_user()) RETURNING id`,
            [b.returnDate, concept.id, r.warehouse_id, po!.number, `Devolución ${ret!.number}: ${b.notes}`, ret!.id],
            client
          );
          movementId = mv!.id;
        }
        movLine += 1;
        await client.query(
          `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
          [movementId, movLine, src.product_id, src.lot_id, stockQty]
        );
      }
      await client.query(
        `INSERT INTO receptions_details (reception_id, line_no, po_line_id, product_id, quantity, stock_quantity, unit_cost, lot_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ret!.id, i + 1, src.po_line_id, src.product_id, l.quantity, stockQty, src.unit_cost, src.lot_id]
      );
      await client.query(`UPDATE purchase_orders_details SET quantity_received = quantity_received - $2 WHERE id = $1`, [src.po_line_id, l.quantity]);
    }

    if (movementId) {
      await client.query(`SELECT fn_post_inventory_movement($1)`, [movementId]);
      await client.query(`UPDATE receptions SET movement_id = $2 WHERE id = $1`, [ret!.id, movementId]);
    }
    if (po!.status !== "closed") await recomputeOrderStatus(client, r.purchase_order_id);
    return ret!.id;
  });
  res.status(201);
  return receptionDetail(returnId, scope);
});
