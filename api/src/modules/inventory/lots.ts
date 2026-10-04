/**
 * @project FabriHub - API
 * @file src/modules/inventory/lots.ts
 * @description Lotes (INV_LOTS) — tesis: Clase Lotes
 *
 * @overview
 * Desde Inventario se corrigen datos del lote y se RETIENE / LIBERA la retención
 * (approved ↔ on_hold). Aprobar o rechazar un lote en cuarentena es de Calidad (fase 4), con
 * segregación de funciones: quien lo registra no lo libera.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "./scope.js";

const SELECT = `SELECT l.id, l.internal_number::int AS "internalNumber", l.lot_code AS "lotCode", l.description,
  l.product_id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
  to_char(l.manufactured_on, 'YYYY-MM-DD') AS "manufacturedOn", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn",
  to_char(l.received_on, 'YYYY-MM-DD') AS "receivedOn", to_char(l.best_before, 'YYYY-MM-DD') AS "bestBefore",
  l.quality_status AS "qualityStatus", l.supplier_lot AS "supplierLot", l.unit_cost::float AS "unitCost",
  (l.expires_on - CURRENT_DATE) AS "daysToExpire",
  COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.lot_id = l.id), 0)::float AS quantity,
  l.updated_at AS "updatedAt"
  FROM lots l JOIN products p ON p.id = l.product_id JOIN catalogs_units u ON u.id = p.stock_unit_id`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  productId: z.uuid().optional(),
  status: z.enum(["quarantine", "approved", "rejected", "on_hold"]).optional(),
  withStock: z.enum(["true", "false"]).optional(),
  expiringDays: z.coerce.number().int().min(0).max(3650).optional()
});

export const listLots = handler({ query: listQuery }, async ({ query: q }) => {
  const rows = await query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM (${SELECT}) x
      WHERE ($1::text IS NULL OR x."lotCode" ILIKE '%' || $1 || '%' OR x."productCode" ILIKE '%' || $1 || '%'
             OR x."productName" ILIKE '%' || $1 || '%' OR x."supplierLot" ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR x."productId" = $2)
        AND ($3::text IS NULL OR x."qualityStatus" = $3)
        AND ($4::boolean IS NULL OR (x.quantity > 0) = $4)
        AND ($5::int IS NULL OR x."daysToExpire" <= $5)
      ORDER BY x."expiresOn" NULLS LAST, x."internalNumber" DESC
      LIMIT $6 OFFSET $7`,
    [
      q.search || null,
      q.productId ?? null,
      q.status ?? null,
      q.withStock === undefined ? null : q.withStock === "true",
      q.expiringDays ?? null,
      q.pageSize,
      (q.page - 1) * q.pageSize
    ]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function lotDetail(id: string, scope: string[] | null) {
  const lot = await one(`${SELECT} WHERE l.id = $1`, [id]);
  if (!lot) throw notFound("Lote no encontrado");
  const [stock, history] = await Promise.all([
    query(
      `SELECT w.code AS "warehouseCode", w.name AS "warehouseName", b.quantity::float AS quantity, b.reserved::float AS reserved
         FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.lot_id = $1 AND b.quantity <> 0 AND ($2::uuid[] IS NULL OR b.warehouse_id = ANY($2))
        ORDER BY w.order_list`,
      [id, scope]
    ),
    query(
      `SELECT m.id AS "movementId", m.number, to_char(m.movement_date, 'YYYY-MM-DD') AS "movementDate", m.direction,
              c.name AS "conceptName", w.code AS "warehouseCode", tw.code AS "targetWarehouseCode",
              d.quantity::float AS quantity, d.unit_cost::float AS "unitCost", m.status
         FROM inventory_movements_details d
         JOIN inventory_movements m ON m.id = d.movement_id
         JOIN catalogs_movement_concepts c ON c.id = m.concept_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN warehouses tw ON tw.id = m.target_warehouse_id
        WHERE d.lot_id = $1 AND m.status <> 'draft'
          AND ($2::uuid[] IS NULL OR m.warehouse_id = ANY($2) OR m.target_warehouse_id = ANY($2))
        ORDER BY m.posted_at, m.number`,
      [id, scope]
    )
  ]);
  return { ...lot, stock, history };
}

export const getLot = handler({ params: idParams }, async ({ params, req }) => lotDetail(params.id, await warehouseScope(req)));

const dateOpt = z.iso.date().nullish();

export const updateLot = handler(
  {
    params: idParams,
    body: z
      .object({
        description: z.string().trim().max(400).nullish(),
        manufacturedOn: dateOpt,
        expiresOn: dateOpt,
        bestBefore: dateOpt,
        supplierLot: z.string().trim().max(40).nullish()
      })
      .refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body: b, req }) => {
    const sets: string[] = [];
    const values: unknown[] = [params.id];
    const add = (col: string, v: unknown) => {
      values.push(v ?? null);
      sets.push(`${col} = $${values.length}`);
    };
    if (b.description !== undefined) add("description", b.description);
    if (b.manufacturedOn !== undefined) add("manufactured_on", b.manufacturedOn);
    if (b.expiresOn !== undefined) add("expires_on", b.expiresOn);
    if (b.bestBefore !== undefined) add("best_before", b.bestBefore);
    if (b.supplierLot !== undefined) add("supplier_lot", b.supplierLot);
    const row = await withTx(txCtx(req), (client) =>
      one(`UPDATE lots SET ${[...sets, "updated_by = fn_current_app_user()"].join(", ")} WHERE id = $1 RETURNING id`, values, client)
    );
    if (!row) throw notFound("Lote no encontrado");
    return lotDetail(params.id, await warehouseScope(req));
  }
);

/** Retener (approved → on_hold) o liberar la retención (on_hold → approved) */
export const setLotHold = (hold: boolean) =>
  handler({ params: idParams, body: z.object({ reason: z.string().trim().min(3).max(300) }) }, async ({ params, body, req }) => {
    const from = hold ? "approved" : "on_hold";
    const to = hold ? "on_hold" : "approved";
    const row = await withTx(txCtx(req), async (client) => {
      const lot = await one<{ quality_status: string; metadata: Record<string, unknown> }>(
        `SELECT quality_status, metadata FROM lots WHERE id = $1 FOR UPDATE`,
        [params.id],
        client
      );
      if (!lot) throw notFound("Lote no encontrado");
      if (lot.quality_status !== from) {
        throw conflict(
          "INVALID_LOT_STATUS",
          hold
            ? "Solo se retiene un lote liberado. Los lotes en cuarentena los gestiona Calidad"
            : "El lote no está retenido"
        );
      }
      return one(
        `UPDATE lots SET quality_status = $2::text, updated_by = fn_current_app_user(),
                metadata = metadata || jsonb_build_object('lastHoldChange', jsonb_build_object('to', $2::text, 'reason', $3::text, 'at', NOW()))
          WHERE id = $1 RETURNING id`,
        [params.id, to, body.reason],
        client
      );
    });
    if (!row) throw badRequest("HOLD_FAILED", "No se pudo cambiar el estado del lote");
    return lotDetail(params.id, await warehouseScope(req));
  });

/** Lotes con existencia de un producto en un almacén (para elegir en salidas y traslados) */
export const lotOptions = handler(
  { query: z.object({ productId: z.uuid(), warehouseId: z.uuid() }) },
  async ({ query: q, req }) => {
    assertInScope(await warehouseScope(req), q.warehouseId);
    return query(
      `SELECT l.id, l.lot_code AS "lotCode", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn",
              l.quality_status AS "qualityStatus", (b.quantity - b.reserved)::float AS available,
              (l.expires_on IS NOT NULL AND l.expires_on < CURRENT_DATE) AS expired
         FROM stock_balances b JOIN lots l ON l.id = b.lot_id
        WHERE b.product_id = $1 AND b.warehouse_id = $2 AND b.quantity > 0
        ORDER BY l.expires_on NULLS LAST, l.internal_number`,
      [q.productId, q.warehouseId]
    );
  }
);
