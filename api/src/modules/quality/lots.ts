/**
 * @project FabriHub - API
 * @file src/modules/quality/lots.ts
 * @description Calidad → Liberación de lotes (QC_LOTS)
 *
 * @overview
 * Un lote que entra en cuarentena (recepción de compra, devolución de cliente, producción) no se
 * puede usar hasta que Calidad lo APRUEBE. Reglas:
 *  - Solo se decide sobre lotes en cuarentena (quarantine → approved | rejected).
 *  - Segregación de funciones: quien registró el lote (recibió o fabricó) no puede decidir sobre él.
 *  - Cada decisión queda en lots_quality_events con su fundamento y referencia de análisis;
 *    la aplicación no puede modificar ni borrar ese registro.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";

const SELECT = `SELECT l.id, l.internal_number::int AS "internalNumber", l.lot_code AS "lotCode", l.quality_status AS "qualityStatus",
  p.id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
  to_char(l.received_on, 'YYYY-MM-DD') AS "receivedOn", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn",
  to_char(l.manufactured_on, 'YYYY-MM-DD') AS "manufacturedOn", l.supplier_lot AS "supplierLot",
  s.legal_name AS "supplierName", po.number AS "orderNumber", m.number AS "movementNumber", c.name AS "originConcept",
  l.created_by AS "createdById", cu.names AS "createdBy",
  COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.lot_id = l.id), 0)::float AS quantity,
  (SELECT row_to_json(e) FROM (SELECT ev.to_status AS "toStatus", ev.notes, ev.analysis_ref AS "analysisRef",
                                      ev.decided_at AS "decidedAt", du.names AS "decidedBy"
                                 FROM lots_quality_events ev LEFT JOIN users du ON du.id = ev.decided_by
                                WHERE ev.lot_id = l.id ORDER BY ev.decided_at DESC LIMIT 1) e) AS "lastDecision"
  FROM lots l
  JOIN products p ON p.id = l.product_id
  JOIN catalogs_units u ON u.id = p.stock_unit_id
  LEFT JOIN suppliers s ON s.id = l.supplier_id
  LEFT JOIN purchase_orders po ON po.id = l.purchase_order_id
  LEFT JOIN inventory_movements m ON m.id = l.origin_movement_id
  LEFT JOIN catalogs_movement_concepts c ON c.id = m.concept_id
  LEFT JOIN users cu ON cu.id = l.created_by`;

const listQuery = pageQuery.extend({
  status: z.enum(["quarantine", "approved", "rejected", "decided"]).default("quarantine"),
  search: z.string().trim().max(60).optional()
});

export const listQualityLots = handler({ query: listQuery }, async ({ query: q }) => {
  const decided = q.status === "decided";
  const rows = await query(
    `SELECT *, COUNT(*) OVER()::int AS total_rows FROM (${SELECT}) x
      WHERE (${decided ? `x."lastDecision" IS NOT NULL` : `x."qualityStatus" = $1`})
        AND ($2::text IS NULL OR x."lotCode" ILIKE '%' || $2 || '%' OR x."productCode" ILIKE '%' || $2 || '%'
             OR x."productName" ILIKE '%' || $2 || '%' OR x."supplierName" ILIKE '%' || $2 || '%')
      ORDER BY ${decided ? `(x."lastDecision"->>'decidedAt') DESC` : `x."receivedOn" NULLS LAST, x."internalNumber"`}
      LIMIT $3 OFFSET $4`,
    [decided ? null : q.status, q.search || null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function qualityDetail(id: string) {
  const lot = await one(`${SELECT} WHERE l.id = $1`, [id]);
  if (!lot) throw notFound("Lote no encontrado");
  const events = await query(
    `SELECT ev.id, ev.from_status AS "fromStatus", ev.to_status AS "toStatus", ev.analysis_ref AS "analysisRef", ev.notes,
            u.names AS "decidedBy", ev.decided_at AS "decidedAt"
       FROM lots_quality_events ev LEFT JOIN users u ON u.id = ev.decided_by
      WHERE ev.lot_id = $1 ORDER BY ev.decided_at DESC`,
    [id]
  );
  return { ...lot, events };
}

export const getQualityLot = handler({ params: idParams }, ({ params }) => qualityDetail(params.id));

const decisionBody = z.object({
  analysisRef: z.string().trim().max(60).nullish(),
  notes: z.string().trim().min(3, "Indique el fundamento de la decisión").max(800)
});

const decide = (to: "approved" | "rejected") =>
  handler({ params: idParams, body: decisionBody }, async ({ params, body, req }) => {
    const me = authOf(req).userId;
    await withTx(txCtx(req), async (client) => {
      const lot = await one<{ quality_status: string; created_by: string | null; lot_code: string }>(
        `SELECT quality_status, created_by, lot_code FROM lots WHERE id = $1 FOR UPDATE`,
        [params.id],
        client
      );
      if (!lot) throw notFound("Lote no encontrado");
      if (lot.quality_status !== "quarantine") {
        throw conflict("NOT_IN_QUARANTINE", `El lote ${lot.lot_code} no está en cuarentena`);
      }
      if (lot.created_by === me) {
        throw forbidden("SELF_APPROVAL", "Segregación de funciones: quien recibió o fabricó el lote no puede decidir sobre él");
      }
      await client.query(`UPDATE lots SET quality_status = $2::text, updated_by = fn_current_app_user() WHERE id = $1`, [params.id, to]);
      await client.query(
        `INSERT INTO lots_quality_events (lot_id, from_status, to_status, analysis_ref, notes, decided_by)
         VALUES ($1, 'quarantine', $2::text, $3, $4, fn_current_app_user())`,
        [params.id, to, body.analysisRef ?? null, body.notes]
      );
    });
    return qualityDetail(params.id);
  });

export const approveLot = decide("approved");
export const rejectLot = decide("rejected");
