/**
 * @project FabriHub - API
 * @file src/modules/dashboard/notifications.ts
 * @description Campana del header (/notifications): cada usuario ve y marca solo LAS SUYAS
 *
 * No depende de un módulo: toda sesión tiene campana. Lo que llega a ella ya se filtró por permisos
 * al crearla (alertVisibleTo); aquí la regla es una sola: `user_id = usuario de la sesión`.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query } from "../../db.js";
import { handler, idParams, notFound } from "../../lib/http.js";
import { authOf } from "../../security/context.js";

const listQuery = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const list = handler({ query: listQuery }, async ({ query: q, req }) => {
  const userId = authOf(req).userId;
  const [items, counts] = await Promise.all([
    query(
      `SELECT n.id, n.kind, n.severity, n.title, n.message, n.link, n.is_read AS "isRead", n.created_at AS "createdAt",
              (a.resolved_at IS NOT NULL) AS "isResolved"
         FROM notifications n LEFT JOIN alerts a ON a.id = n.alert_id
        WHERE n.user_id = $1 AND ($2::boolean IS NULL OR n.is_read = NOT $2::boolean)
        ORDER BY n.created_at DESC, CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END
        LIMIT $3`,
      [userId, q.unread === undefined ? null : q.unread === "true", q.limit]
    ),
    one<{ unread: number; total: number }>(
      `SELECT COUNT(*) FILTER (WHERE NOT is_read)::int AS unread, COUNT(*)::int AS total FROM notifications WHERE user_id = $1`,
      [userId]
    )
  ]);
  return { items, unread: counts?.unread ?? 0, total: counts?.total ?? 0 };
});

const markRead = handler({ params: idParams }, async ({ params, req }) => {
  const row = await one(
    `UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id`,
    [params.id, authOf(req).userId]
  );
  if (!row) throw notFound("Notificación no encontrada");
  return undefined;
});

const markAllRead = handler({}, async ({ req }) => {
  const rows = await query(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1 AND NOT is_read RETURNING id`, [
    authOf(req).userId
  ]);
  return { updated: rows.length };
});

export const notificationsRoutes = Router();
notificationsRoutes.get("/", list);
notificationsRoutes.post("/read-all", markAllRead);
notificationsRoutes.post("/:id/read", markRead);
