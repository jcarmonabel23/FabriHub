/**
 * @project FabriHub - API
 * @file src/modules/production/tracking.ts
 * @description Seguimiento de la producción (PRD_TRACKING) — tesis: Clase Procesos (Hora de Inicio / Hora de Fin)
 *
 * @overview
 * Cada orden liberada tiene una fila por etapa de su ruta. El operador INICIA una etapa (la orden
 * pasa a "en proceso") y la TERMINA declarando horas reales, cantidad buena y merma. Las etapas
 * van en orden: no se inicia una mientras la anterior no esté terminada (trazabilidad GMP).
 * Las horas reales × las tarifas del centro de trabajo son la mano de obra y el costo fabril reales.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const SELECT = `SELECT pp.id, pp.sequence, pp.status, pp.production_order_id AS "orderId", o.number AS "orderNumber", o.status AS "orderStatus",
  o.priority, p.code AS "productCode", p.name AS "productName", u.code AS "unitCode", o.quantity_planned::float AS "quantityPlanned",
  to_char(o.planned_start, 'YYYY-MM-DD') AS "plannedStart", to_char(o.planned_end, 'YYYY-MM-DD') AS "plannedEnd",
  s.code AS "stageCode", s.name AS "stageName", wc.id AS "workCenterId", wc.code AS "workCenterCode", wc.name AS "workCenterName",
  pp.std_hours::float AS "stdHours", pp.real_hours::float AS "realHours",
  pp.quantity_good::float AS "quantityGood", pp.quantity_scrap::float AS "quantityScrap",
  pp.started_at AS "startedAt", su.names AS "startedBy", pp.finished_at AS "finishedAt", fu.names AS "finishedBy", pp.notes,
  (SELECT COUNT(*) FROM production_processes prev WHERE prev.production_order_id = pp.production_order_id
      AND prev.sequence < pp.sequence AND prev.status <> 'done')::int AS "previousPending"
  FROM production_processes pp
  JOIN production_orders o ON o.id = pp.production_order_id
  JOIN products p ON p.id = o.product_id
  JOIN catalogs_units u ON u.id = p.stock_unit_id
  JOIN stages s ON s.id = pp.stage_id
  JOIN work_centers wc ON wc.id = pp.work_center_id
  LEFT JOIN users su ON su.id = pp.started_by
  LEFT JOIN users fu ON fu.id = pp.finished_by`;

export const listProcesses = handler(
  {
    query: z.object({
      workCenterId: z.uuid().optional(),
      status: z.enum(["pending", "in_process", "done", "open"]).default("open"),
      search: z.string().trim().max(60).optional()
    })
  },
  ({ query: q }) =>
    query(
      `${SELECT}
        WHERE o.status IN ('released', 'in_process', 'confirmed')
          AND ($1::uuid IS NULL OR pp.work_center_id = $1)
          AND (($2::text = 'open' AND pp.status <> 'done') OR pp.status = $2::text)
          AND ($3::text IS NULL OR o.number ILIKE '%' || $3 || '%' OR p.code ILIKE '%' || $3 || '%' OR p.name ILIKE '%' || $3 || '%')
        ORDER BY CASE pp.status WHEN 'in_process' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, o.priority, o.planned_start, o.number, pp.sequence
        LIMIT 300`,
      [q.workCenterId ?? null, q.status, q.search || null]
    )
);

const processParams = z.object({ id: z.uuid() });

async function lockProcess(client: pg.PoolClient, id: string) {
  const p = await one<{ id: string; status: string; sequence: number; production_order_id: string; order_status: string; number: string; started_at: Date | null }>(
    `SELECT pp.id, pp.status, pp.sequence, pp.production_order_id, o.status AS order_status, o.number, pp.started_at
       FROM production_processes pp JOIN production_orders o ON o.id = pp.production_order_id
      WHERE pp.id = $1 FOR UPDATE OF pp, o`,
    [id],
    client
  );
  if (!p) throw notFound("Etapa no encontrada");
  if (!["released", "in_process"].includes(p.order_status)) {
    throw conflict("INVALID_STATUS", `La orden ${p.number} no está liberada ni en proceso`);
  }
  return p;
}

export const startProcess = handler({ params: processParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const p = await lockProcess(client, params.id);
    if (p.status !== "pending") throw conflict("ALREADY_STARTED", "La etapa ya fue iniciada");
    const prev = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM production_processes WHERE production_order_id = $1 AND sequence < $2 AND status <> 'done'`,
      [p.production_order_id, p.sequence],
      client
    );
    if (prev!.n > 0) throw conflict("PREVIOUS_PENDING", "Termine primero las etapas anteriores de la ruta");
    await client.query(
      `UPDATE production_processes SET status = 'in_process', started_at = NOW(), started_by = fn_current_app_user() WHERE id = $1`,
      [params.id]
    );
    await client.query(
      `UPDATE production_orders SET status = 'in_process', started_at = COALESCE(started_at, NOW()), updated_by = fn_current_app_user()
        WHERE id = $1 AND status = 'released'`,
      [p.production_order_id]
    );
  });
  return one(`${SELECT} WHERE pp.id = $1`, [params.id]);
});

export const finishProcess = handler(
  {
    params: processParams,
    body: z.object({
      realHours: z.number().min(0).max(10000).optional(),
      quantityGood: z.number().min(0).max(1e12).nullish(),
      quantityScrap: z.number().min(0).max(1e12).nullish(),
      notes: z.string().trim().max(800).nullish()
    })
  },
  async ({ params, body: b, req }) => {
    await withTx(txCtx(req), async (client) => {
      const p = await lockProcess(client, params.id);
      if (p.status !== "in_process") throw conflict("NOT_STARTED", p.status === "done" ? "La etapa ya está terminada" : "Inicie la etapa primero");
      // Sin horas declaradas, se toma el tiempo transcurrido desde el inicio.
      const hours =
        b.realHours ?? Math.round(((Date.now() - new Date(p.started_at ?? Date.now()).getTime()) / 3_600_000) * 100) / 100;
      if (hours < 0) throw badRequest("INVALID_HOURS", "Horas inválidas");
      await client.query(
        `UPDATE production_processes SET status = 'done', finished_at = NOW(), finished_by = fn_current_app_user(), real_hours = $2,
                quantity_good = $3, quantity_scrap = $4, notes = $5 WHERE id = $1`,
        [params.id, hours, b.quantityGood ?? null, b.quantityScrap ?? null, b.notes ?? null]
      );
    });
    return one(`${SELECT} WHERE pp.id = $1`, [params.id]);
  }
);
