/**
 * @project FabriHub - API
 * @file src/modules/sales/deliveries.ts
 * @description Notas de entrega (SAL_DELIVERY_NOTES) — tesis: Nota de Entrega con selección FEFO de lotes
 *
 * @overview
 * Despachar (tesis: Generar Nota de Entrega → Salida del Almacén → Cambiar Estado de la OV):
 *  1. Por cada línea se decide de qué lotes sale: automático (primero lo reservado para la línea y
 *     luego lo libre, ambos por fecha de vencimiento) o lotes indicados por el usuario.
 *  2. Con SALES.enforce_fefo, los lotes indicados deben respetar FEFO: no se toma un lote mientras
 *     quede disponible otro que vence antes (409 FEFO_VIOLATION).
 *  3. Se descuenta la reserva, se genera la salida DESP_VENTA y el motor de inventario la valúa al
 *     costo promedio; queda el costo y el margen de lo despachado.
 *  4. Se suma lo despachado y se recalcula el estado de la orden.
 * Anular una nota reversa su movimiento (vuelve la existencia) y re-reserva lo pendiente.
 * La trazabilidad lote → cliente sale de las líneas (una por lote).
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "../inventory/scope.js";
import { orderDetail, reserveOrder } from "./orders.js";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-9;

async function recomputeOrderStatus(client: pg.PoolClient, orderId: string) {
  await client.query(
    `UPDATE sales_orders so
        SET status = CASE
              WHEN NOT EXISTS (SELECT 1 FROM sales_orders_details d WHERE d.sales_order_id = so.id AND d.quantity_delivered < d.quantity) THEN 'delivered'
              WHEN EXISTS (SELECT 1 FROM sales_orders_details d WHERE d.sales_order_id = so.id AND d.quantity_delivered > 0) THEN 'partially_delivered'
              ELSE 'confirmed' END,
            updated_by = fn_current_app_user()
      WHERE so.id = $1 AND so.status IN ('confirmed', 'partially_delivered', 'delivered')`,
    [orderId]
  );
  // Una orden completa no conserva reservas.
  await client.query(
    `DELETE FROM stock_reservations WHERE source_document_id = $1 AND EXISTS (SELECT 1 FROM sales_orders WHERE id = $1 AND status = 'delivered')`,
    [orderId]
  );
}

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT n.id, n.number, n.status, to_char(n.delivery_date, 'YYYY-MM-DD') AS "deliveryDate",
  n.carrier, n.delivery_address AS "deliveryAddress", n.notes, n.net_amount::float AS "netAmount", n.cost_amount::float AS "costAmount",
  n.sales_order_id AS "salesOrderId", so.number AS "orderNumber", so.status AS "orderStatus", cur.code AS "currencyCode",
  so.exchange_rate::float AS "exchangeRate",
  c.id AS "customerId", c.legal_name AS "customerName", c.rif AS "customerRif",
  w.id AS "warehouseId", w.code AS "warehouseCode", n.movement_id AS "movementId", m.number AS "movementNumber",
  u.names AS "createdBy", n.created_at AS "createdAt", xu.names AS "cancelledBy", n.cancelled_at AS "cancelledAt", n.cancel_reason AS "cancelReason"
  FROM delivery_notes n
  JOIN sales_orders so ON so.id = n.sales_order_id
  JOIN customers c ON c.id = so.customer_id
  JOIN catalogs_currencies cur ON cur.id = so.currency_id
  JOIN warehouses w ON w.id = n.warehouse_id
  LEFT JOIN inventory_movements m ON m.id = n.movement_id
  LEFT JOIN users u ON u.id = n.created_by
  LEFT JOIN users xu ON xu.id = n.cancelled_by`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listDeliveries = handler({ query: listQuery }, async ({ query: q, req }) => {
  const scope = await warehouseScope(req);
  const rows = await query(
    `${HEADER.replace("SELECT n.id,", "SELECT COUNT(*) OVER()::int AS total_rows, n.id,")}
      WHERE ($1::uuid[] IS NULL OR n.warehouse_id = ANY($1))
        AND ($2::text IS NULL OR n.number ILIKE '%' || $2 || '%' OR so.number ILIKE '%' || $2 || '%' OR c.legal_name ILIKE '%' || $2 || '%')
        AND ($3::date IS NULL OR n.delivery_date >= $3)
        AND ($4::date IS NULL OR n.delivery_date <= $4)
      ORDER BY n.created_at DESC LIMIT $5 OFFSET $6`,
    [scope, q.search || null, q.from ?? null, q.to ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function deliveryDetail(id: string, scope: string[] | null) {
  const header = await one<{ warehouseId: string }>(`${HEADER} WHERE n.id = $1`, [id]);
  if (!header || (scope && !scope.includes(header.warehouseId))) throw notFound("Nota de entrega no encontrada");
  const lines = await query(
    `SELECT dd.id, dd.line_no AS "lineNo", dd.so_line_id AS "soLineId", p.code AS "productCode", p.name AS "productName",
            u.code AS "unitCode", su.code AS "stockUnitCode", dd.quantity::float AS quantity, dd.stock_quantity::float AS "stockQuantity",
            dd.unit_price::float AS "unitPrice", dd.unit_cost::float AS "unitCost",
            dd.lot_id AS "lotId", l.lot_code AS "lotCode", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn"
       FROM delivery_notes_details dd
       JOIN products p ON p.id = dd.product_id
       JOIN sales_orders_details d ON d.id = dd.so_line_id
       JOIN catalogs_units u ON u.id = d.unit_id
       JOIN catalogs_units su ON su.id = p.stock_unit_id
       LEFT JOIN lots l ON l.id = dd.lot_id
      WHERE dd.delivery_note_id = $1 ORDER BY dd.line_no`,
    [id]
  );
  return { ...header, lines };
}

export const getDelivery = handler({ params: idParams }, async ({ params, req }) => deliveryDetail(params.id, await warehouseScope(req)));

/** Órdenes con pendientes por despachar en los almacenes del usuario */
export const pendingOrders = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  return query(
    `SELECT so.id, so.number, so.status, to_char(so.order_date, 'YYYY-MM-DD') AS "orderDate",
            to_char(so.requested_date, 'YYYY-MM-DD') AS "requestedDate", c.legal_name AS "customerName", w.code AS "warehouseCode",
            (SELECT COUNT(*) FROM sales_orders_details d WHERE d.sales_order_id = so.id AND d.quantity_delivered < d.quantity)::int AS "pendingLines",
            (so.requested_date < CURRENT_DATE) AS "isLate"
       FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN warehouses w ON w.id = so.warehouse_id
      WHERE so.status IN ('confirmed', 'partially_delivered') AND ($1::uuid[] IS NULL OR so.warehouse_id = ANY($1))
      ORDER BY so.requested_date NULLS LAST, so.number`,
    [scope]
  );
});

/** La orden vista desde Despacho, con los lotes disponibles de cada producto (para elegir a mano) */
export const orderForDelivery = handler({ params: idParams }, async ({ params, req }) => {
  const so = await one<{ warehouse_id: string }>(`SELECT warehouse_id FROM sales_orders WHERE id = $1`, [params.id]);
  if (!so) throw notFound("Orden de venta no encontrada");
  assertInScope(await warehouseScope(req), so.warehouse_id);
  const detail = await orderDetail(params.id);
  const lots = await query(
    `SELECT d.id AS "soLineId", a.lot_id AS "lotId", a.lot_code AS "lotCode", to_char(a.expires_on, 'YYYY-MM-DD') AS "expiresOn",
            (a.available + COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id AND r.lot_id IS NOT DISTINCT FROM a.lot_id), 0))::float AS capacity
       FROM sales_orders_details d
       JOIN sales_orders so ON so.id = d.sales_order_id
       JOIN (SELECT b.warehouse_id, b.product_id, b.lot_id, l.lot_code, l.expires_on, b.quantity - b.reserved AS available
               FROM stock_balances b LEFT JOIN lots l ON l.id = b.lot_id
              WHERE b.quantity > 0 AND (b.lot_id IS NULL OR (l.quality_status = 'approved' AND (l.expires_on IS NULL OR l.expires_on >= CURRENT_DATE)))) a
         ON a.warehouse_id = so.warehouse_id AND a.product_id = d.product_id
      WHERE d.sales_order_id = $1
      ORDER BY a.expires_on NULLS LAST, a.lot_code`,
    [params.id]
  );
  return { ...detail, lots: lots.filter((l) => Number(l.capacity) > EPS) };
});

// ------------------------------------------------------------------ Despachar

const deliverBody = z.object({
  deliveryDate: z.iso.date(),
  carrier: z.string().trim().max(120).nullish(),
  deliveryAddress: z.string().trim().max(400).nullish(),
  notes: z.string().trim().max(800).nullish(),
  lines: z
    .array(
      z.object({
        soLineId: z.uuid(),
        quantity: z.number().positive().max(1e12),
        /** Lotes elegidos a mano (cantidades en la unidad de la orden). Sin ellos, FEFO automático. */
        lots: z.array(z.object({ lotId: z.uuid().nullable(), quantity: z.number().positive().max(1e12) })).max(50).optional()
      })
    )
    .min(1, "Indique al menos una línea a despachar")
    .max(200)
});

interface SoLine {
  id: string;
  line_no: number;
  product_id: string;
  code: string;
  is_stockable: boolean;
  unit_factor: string;
  quantity: string;
  quantity_delivered: string;
  unit_price: string;
  discount_pct: string;
}

interface Capacity {
  lotId: string | null;
  lotCode: string | null;
  expiresOn: string | null;
  free: number;
  reserved: number;
}

export const deliverOrder = handler({ params: idParams, body: deliverBody }, async ({ params, body: b, req, res }) => {
  const scope = await warehouseScope(req);
  const noteId = await withTx(txCtx(req), async (client) => {
    const so = await one<{ number: string; status: string; warehouse_id: string; discount_pct: string; delivery_address: string | null }>(
      `SELECT number, status, warehouse_id, discount_pct, delivery_address FROM sales_orders WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!so) throw notFound("Orden de venta no encontrada");
    if (!["confirmed", "partially_delivered"].includes(so.status)) throw conflict("INVALID_STATUS", `La orden ${so.number} no está confirmada para despachar`);
    assertInScope(scope, so.warehouse_id);
    const future = await one<{ f: boolean }>(`SELECT $1::date > CURRENT_DATE AS f`, [b.deliveryDate], client);
    if (future?.f) throw badRequest("FUTURE_DATE", "La fecha no puede ser futura");

    const ids = b.lines.map((l) => l.soLineId);
    if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATED_LINE", "Una línea de la orden aparece dos veces");
    const soLines = new Map(
      (
        await query<SoLine>(
          `SELECT d.id, d.line_no, d.product_id, p.code, p.is_stockable, d.unit_factor, d.quantity, d.quantity_delivered, d.unit_price, d.discount_pct
             FROM sales_orders_details d JOIN products p ON p.id = d.product_id
            WHERE d.sales_order_id = $1 AND d.id = ANY($2) FOR UPDATE OF d`,
          [params.id, ids],
          client
        )
      ).map((l) => [l.id, l])
    );
    const enforceFefo = (await one<{ v: boolean }>(`SELECT COALESCE((fn_parameter('SALES', 'enforce_fefo'))::text::boolean, TRUE) AS v`, [], client))!.v;

    // 1) Decidir lotes (sin tocar nada todavía): capacidad = libre + reservado para ESTA línea.
    const freeUsed = new Map<string, number>(); // lote → libre ya asignado en esta nota (dos líneas del mismo producto)
    const plan: { line: SoLine; quantity: number; picks: { lotId: string | null; stockQty: number; fromReserved: number }[] }[] = [];
    for (const rq of b.lines) {
      const l = soLines.get(rq.soLineId);
      if (!l) throw badRequest("INVALID_LINE", "Una línea no pertenece a la orden");
      const pending = round6(Number(l.quantity) - Number(l.quantity_delivered));
      if (rq.quantity > pending + EPS) throw badRequest("OVER_DELIVERY", `Línea ${l.line_no} (${l.code}): quedan ${pending} por despachar`);
      const factor = Number(l.unit_factor);
      const stockQty = round6(rq.quantity * factor);
      if (!l.is_stockable) {
        plan.push({ line: l, quantity: rq.quantity, picks: [] });
        continue;
      }

      const caps = (
        await query<{ lot_id: string | null; lot_code: string | null; expires_on: string | null; free: string; reserved: string }>(
          `SELECT b.lot_id, l.lot_code, to_char(l.expires_on, 'YYYY-MM-DD') AS expires_on, b.quantity - b.reserved AS free,
                  COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = $3 AND r.lot_id IS NOT DISTINCT FROM b.lot_id), 0) AS reserved
             FROM stock_balances b LEFT JOIN lots l ON l.id = b.lot_id
            WHERE b.warehouse_id = $1 AND b.product_id = $2 AND b.quantity > 0
              AND (b.lot_id IS NULL OR (l.quality_status = 'approved' AND (l.expires_on IS NULL OR l.expires_on >= $4::date)))
            ORDER BY l.expires_on NULLS LAST, l.lot_code NULLS FIRST`,
          [so.warehouse_id, l.product_id, l.id, b.deliveryDate],
          client
        )
      ).map<Capacity>((c) => {
        const key = c.lot_id ?? "";
        return { lotId: c.lot_id, lotCode: c.lot_code, expiresOn: c.expires_on, free: Math.max(0, round6(Number(c.free) - (freeUsed.get(key) ?? 0))), reserved: Number(c.reserved) };
      });
      const capOf = (c: Capacity) => round6(c.free + c.reserved);

      let wanted: { lotId: string | null; stockQty: number }[];
      if (rq.lots?.length) {
        wanted = rq.lots.map((x) => ({ lotId: x.lotId, stockQty: round6(x.quantity * factor) }));
        const sum = round6(wanted.reduce((a, x) => a + x.stockQty, 0));
        if (Math.abs(sum - stockQty) > 1e-6) throw badRequest("LOTS_MISMATCH", `Línea ${l.line_no}: los lotes suman ${round6(sum / factor)} y se despachan ${rq.quantity}`);
        for (const w of wanted) {
          const c = caps.find((x) => x.lotId === w.lotId);
          if (!c || w.stockQty > capOf(c) + EPS) throw conflict("LOT_UNAVAILABLE", `Línea ${l.line_no}: el lote no está disponible en esa cantidad`);
        }
        if (enforceFefo) {
          // Ningún lote elegido puede vencer después de uno que quedaría con disponible.
          for (const w of wanted) {
            const chosen = caps.find((x) => x.lotId === w.lotId)!;
            const earlier = caps.find((c) => {
              if (!c.expiresOn || !chosen.expiresOn || c.expiresOn >= chosen.expiresOn) return false;
              const taken = wanted.filter((x) => x.lotId === c.lotId).reduce((a, x) => a + x.stockQty, 0);
              return capOf(c) - taken > EPS;
            });
            if (earlier) {
              throw conflict("FEFO_VIOLATION", `Línea ${l.line_no}: debe despacharse antes el lote ${earlier.lotCode}, que vence el ${earlier.expiresOn} (FEFO)`);
            }
          }
        }
      } else {
        // Automático: primero lo reservado para la línea, luego lo libre; ambos por vencimiento.
        wanted = [];
        let need = stockQty;
        for (const kind of ["reserved", "free"] as const) {
          for (const c of caps) {
            if (need <= EPS) break;
            const already = wanted.find((x) => x.lotId === c.lotId);
            const room = round6((kind === "reserved" ? c.reserved : capOf(c)) - (already?.stockQty ?? 0));
            const take = round6(Math.min(room, need));
            if (take <= EPS) continue;
            if (already) already.stockQty = round6(already.stockQty + take);
            else wanted.push({ lotId: c.lotId, stockQty: take });
            need = round6(need - take);
          }
        }
        if (need > EPS) throw conflict("INSUFFICIENT_STOCK", `Línea ${l.line_no} (${l.code}): faltan ${round6(need / factor)} para despachar lo indicado`);
      }

      const picks = wanted.map((w) => {
        const c = caps.find((x) => x.lotId === w.lotId)!;
        const fromReserved = round6(Math.min(c.reserved, w.stockQty));
        const fromFree = round6(w.stockQty - fromReserved);
        if (fromFree > EPS) freeUsed.set(w.lotId ?? "", (freeUsed.get(w.lotId ?? "") ?? 0) + fromFree);
        return { lotId: w.lotId, stockQty: w.stockQty, fromReserved };
      });
      plan.push({ line: l, quantity: rq.quantity, picks });
    }

    // 2) Nota, liberación de reservas y salida DESP_VENTA
    const note = await one<{ id: string; number: string }>(
      `INSERT INTO delivery_notes (number, sales_order_id, delivery_date, warehouse_id, delivery_address, carrier, notes, created_by)
       VALUES (fn_next_document_number('DN'), $1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id, number`,
      [params.id, b.deliveryDate, so.warehouse_id, b.deliveryAddress ?? so.delivery_address, b.carrier ?? null, b.notes ?? null],
      client
    );
    const concept = await one<{ id: string }>(`SELECT id FROM catalogs_movement_concepts WHERE code = 'DESP_VENTA' AND is_active`, [], client);
    if (!concept) throw conflict("CONCEPT_MISSING", "El concepto de inventario DESP_VENTA no existe o está inactivo");

    let movementId: string | null = null;
    const movLines: { noteLine: number; stockQty: number }[] = [];
    let noteLine = 0;
    const globalDisc = 1 - Number(so.discount_pct) / 100;
    let netAmount = 0;
    for (const p of plan) {
      const factor = Number(p.line.unit_factor);
      const netPrice = Number(p.line.unit_price) * (1 - Number(p.line.discount_pct) / 100) * globalDisc;
      const parts = p.picks.length ? p.picks : [{ lotId: null, stockQty: round6(p.quantity * factor), fromReserved: 0 }];
      for (const pick of parts) {
        noteLine += 1;
        if (p.line.is_stockable) {
          if (pick.fromReserved > EPS) {
            const r = await one<{ id: string; quantity: string }>(
              `SELECT id, quantity FROM stock_reservations WHERE source_line_id = $1 AND lot_id IS NOT DISTINCT FROM $2 FOR UPDATE`,
              [p.line.id, pick.lotId],
              client
            );
            const left = round6(Number(r!.quantity) - pick.fromReserved);
            if (left > EPS) await client.query(`UPDATE stock_reservations SET quantity = $2 WHERE id = $1`, [r!.id, left]);
            else await client.query(`DELETE FROM stock_reservations WHERE id = $1`, [r!.id]);
          }
          if (!movementId) {
            const mv = await one<{ id: string }>(
              `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes, source_module, source_document_id, created_by)
               VALUES (fn_next_document_number('MOV'), $1, $2, 'out', $3, $4, $5, 'SALES', $6, fn_current_app_user()) RETURNING id`,
              [b.deliveryDate, concept.id, so.warehouse_id, so.number, `Nota de entrega ${note!.number}`, note!.id],
              client
            );
            movementId = mv!.id;
          }
          movLines.push({ noteLine, stockQty: pick.stockQty });
          await client.query(
            `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
            [movementId, movLines.length, p.line.product_id, pick.lotId, pick.stockQty]
          );
        }
        const qty = round6(pick.stockQty / factor);
        netAmount += qty * netPrice;
        await client.query(
          `INSERT INTO delivery_notes_details (delivery_note_id, line_no, so_line_id, product_id, lot_id, quantity, stock_quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [note!.id, noteLine, p.line.id, p.line.product_id, pick.lotId, qty, pick.stockQty, Math.round(netPrice * 10000) / 10000]
        );
      }
      await client.query(`UPDATE sales_orders_details SET quantity_delivered = quantity_delivered + $2 WHERE id = $1`, [p.line.id, p.quantity]);
    }

    let cost = 0;
    if (movementId) {
      await client.query(`SELECT fn_post_inventory_movement($1)`, [movementId]);
      const posted = await query<{ line_no: number; unit_cost: string; total_cost: string }>(
        `SELECT line_no, unit_cost, total_cost FROM inventory_movements_details WHERE movement_id = $1`,
        [movementId],
        client
      );
      for (const d of posted) {
        cost += Number(d.total_cost);
        await client.query(`UPDATE delivery_notes_details SET unit_cost = $3 WHERE delivery_note_id = $1 AND line_no = $2`, [
          note!.id,
          movLines[d.line_no - 1].noteLine,
          d.unit_cost
        ]);
      }
    }
    await client.query(`UPDATE delivery_notes SET movement_id = $2, net_amount = $3, cost_amount = $4 WHERE id = $1`, [
      note!.id,
      movementId,
      Math.round(netAmount * 100) / 100,
      cost
    ]);
    await recomputeOrderStatus(client, params.id);
    return note!.id;
  });
  res.status(201);
  return deliveryDetail(noteId, scope);
});

// ------------------------------------------------------------------ Anular

export const cancelDelivery = handler(
  { params: idParams, body: z.object({ reason: z.string().trim().min(3, "Indique el motivo").max(400) }) },
  async ({ params, body, req }) => {
    const scope = await warehouseScope(req);
    await withTx(txCtx(req), async (client) => {
      const n = await one<{ status: string; number: string; sales_order_id: string; movement_id: string | null; warehouse_id: string }>(
        `SELECT status, number, sales_order_id, movement_id, warehouse_id FROM delivery_notes WHERE id = $1 FOR UPDATE`,
        [params.id],
        client
      );
      if (!n) throw notFound("Nota de entrega no encontrada");
      assertInScope(scope, n.warehouse_id);
      if (n.status !== "posted") throw conflict("ALREADY_CANCELLED", `La nota ${n.number} ya está anulada`);
      const so = await one<{ status: string }>(`SELECT status FROM sales_orders WHERE id = $1 FOR UPDATE`, [n.sales_order_id], client);
      if (so!.status === "closed") throw conflict("ORDER_CLOSED", "La orden está cerrada: no se anulan sus despachos");

      if (n.movement_id) await client.query(`SELECT fn_reverse_inventory_movement($1)`, [n.movement_id]);
      await client.query(
        `UPDATE sales_orders_details d SET quantity_delivered = GREATEST(d.quantity_delivered - x.qty, 0)
           FROM (SELECT so_line_id, SUM(quantity) AS qty FROM delivery_notes_details WHERE delivery_note_id = $1 GROUP BY so_line_id) x
          WHERE d.id = x.so_line_id`,
        [params.id]
      );
      await client.query(
        `UPDATE delivery_notes SET status = 'cancelled', cancelled_by = fn_current_app_user(), cancelled_at = NOW(), cancel_reason = $2 WHERE id = $1`,
        [params.id, body.reason]
      );
      await recomputeOrderStatus(client, n.sales_order_id);
      // Lo que vuelve al almacén se reserva otra vez para la orden (sin exigir que alcance).
      await reserveOrder(client, n.sales_order_id, false);
    });
    return deliveryDetail(params.id, scope);
  }
);

// ------------------------------------------------------------------ Trazabilidad lote → cliente

export const traceLot = handler(
  { query: z.object({ lotId: z.uuid().optional(), lotCode: z.string().trim().min(1).max(40).optional() }).refine((q) => q.lotId || q.lotCode, "Indique el lote") },
  async ({ query: q }) => {
    const lots = await query<{ id: string }>(
      `SELECT l.id, l.lot_code AS "lotCode", p.code AS "productCode", p.name AS "productName", su.code AS "unitCode",
              to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn", l.quality_status AS "qualityStatus",
              po.number AS "productionOrderNumber", s.legal_name AS "supplierName"
         FROM lots l JOIN products p ON p.id = l.product_id JOIN catalogs_units su ON su.id = p.stock_unit_id
         LEFT JOIN production_orders po ON po.id = l.production_order_id
         LEFT JOIN suppliers s ON s.id = l.supplier_id
        WHERE ($1::uuid IS NOT NULL AND l.id = $1) OR ($1::uuid IS NULL AND upper(l.lot_code) = upper($2::text))
        ORDER BY p.code LIMIT 20`,
      [q.lotId ?? null, q.lotCode ?? null]
    );
    return Promise.all(
      lots.map(async (lot) => ({
        lot,
        deliveries: await query(
          `SELECT n.id, n.number, n.status, to_char(n.delivery_date, 'YYYY-MM-DD') AS "deliveryDate", so.number AS "orderNumber",
                  c.code AS "customerCode", c.legal_name AS "customerName", c.rif AS "customerRif", c.phones, c.email,
                  SUM(dd.stock_quantity)::float AS quantity
             FROM delivery_notes_details dd
             JOIN delivery_notes n ON n.id = dd.delivery_note_id
             JOIN sales_orders so ON so.id = n.sales_order_id
             JOIN customers c ON c.id = so.customer_id
            WHERE dd.lot_id = $1
            GROUP BY n.id, so.number, c.id
            ORDER BY n.delivery_date, n.number`,
          [lot.id]
        )
      }))
    );
  }
);
