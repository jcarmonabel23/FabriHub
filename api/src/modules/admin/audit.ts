/**
 * @project FabriHub - API
 * @file src/modules/admin/audit.ts
 * @description Consulta de auditoría de datos y de accesos (módulo ADM_AUDIT, solo lectura)
 */

import { z } from "zod";
import { query } from "../../db.js";
import { handler, pageQuery } from "../../lib/http.js";

export const AUDIT_MODULE = "ADM_AUDIT";

const range = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
};

const dataQuery = pageQuery.extend({
  table: z.string().regex(/^[a-z_]+$/).optional(),
  userId: z.uuid().optional(),
  recordId: z.string().max(80).optional(),
  action: z.enum(["I", "U", "D"]).optional(),
  ...range
});

export const listDataAudit = handler({ query: dataQuery }, async ({ query: q }) => {
  const rows = await query(
    `SELECT a.id, a.table_name AS "tableName", a.record_id AS "recordId", a.action,
            a.old_data AS "oldData", a.new_data AS "newData", a.changed_fields AS "changedFields",
            a.trace_id AS "traceId", a.created_at AS "createdAt",
            a.user_id AS "userId", u.names AS "userNames", u.email AS "userEmail",
            COUNT(*) OVER()::int AS total
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ($1::text IS NULL OR a.table_name = $1)
        AND ($2::uuid IS NULL OR a.user_id = $2)
        AND ($3::text IS NULL OR a.record_id = $3)
        AND ($4::text IS NULL OR a.action = $4)
        AND ($5::timestamptz IS NULL OR a.created_at >= $5)
        AND ($6::timestamptz IS NULL OR a.created_at < $6)
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $7 OFFSET $8`,
    [q.table ?? null, q.userId ?? null, q.recordId ?? null, q.action ?? null, q.from ?? null, q.to ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export const listAuditTables = handler({}, async () =>
  (await query<{ t: string }>(`SELECT DISTINCT table_name AS t FROM audit_log ORDER BY 1`)).map((r) => r.t)
);

const authQuery = pageQuery.extend({
  email: z.string().trim().max(200).optional(),
  event: z.string().regex(/^[a-z_]+$/).optional(),
  success: z.enum(["true", "false"]).optional(),
  ...range
});

export const listAuthAudit = handler({ query: authQuery }, async ({ query: q }) => {
  const rows = await query(
    `SELECT h.id, h.user_id AS "userId", h.email, h.event_type AS "eventType", h.success, h.detail,
            h.trace_id AS "traceId", h.ip_address AS "ipAddress", h.user_agent AS "userAgent",
            h.created_at AS "createdAt", COUNT(*) OVER()::int AS total
       FROM users_auth_history h
      WHERE ($1::text IS NULL OR h.email::text ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR h.event_type = $2)
        AND ($3::boolean IS NULL OR h.success = $3)
        AND ($4::timestamptz IS NULL OR h.created_at >= $4)
        AND ($5::timestamptz IS NULL OR h.created_at < $5)
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT $6 OFFSET $7`,
    [
      q.email || null,
      q.event ?? null,
      q.success === undefined ? null : q.success === "true",
      q.from ?? null,
      q.to ?? null,
      q.pageSize,
      (q.page - 1) * q.pageSize
    ]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});
