/**
 * @project FabriHub - API
 * @file src/modules/admin/modules.ts
 * @description Estado y visibilidad de los módulos (módulo ADM_MODULES)
 *
 * @overview
 * El árbol de Seguridad (ADMIN y sus hojas) no puede ponerse fuera de servicio ni ocultarse:
 * sería cerrar la única puerta para volver a encenderlo.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { forbidden, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

export const MODULES_MODULE = "ADM_MODULES";

const COLUMNS = `m.id, m.code, m.name, m.description, m.icon, m.path, m.order_list AS "orderList",
  p.code AS "parentCode", m.is_public AS "isPublic", m.is_offline AS "isOffline",
  m.is_show_dev AS "isShowDev", m.is_show_qa AS "isShowQa", m.is_show_prod AS "isShowProd",
  m.metadata, m.updated_at AS "updatedAt",
  (SELECT COUNT(*)::int FROM users_modules um WHERE um.module_id = m.id AND um.is_active) AS "usersCount"`;

export const listModules = handler({}, () =>
  query(
    `SELECT ${COLUMNS}
       FROM catalogs_modules m LEFT JOIN catalogs_modules p ON p.id = m.module_parent_id
      ORDER BY COALESCE(p.order_list, m.order_list), p.order_list NULLS FIRST, m.order_list`
  )
);

const updateBody = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(400).optional(),
    isOffline: z.boolean().optional(),
    isShowDev: z.boolean().optional(),
    isShowQa: z.boolean().optional(),
    isShowProd: z.boolean().optional()
  })
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

export const updateModule = handler({ params: idParams, body: updateBody }, async ({ params, body, req }) => {
  const mod = await one<{ code: string; parent_code: string | null }>(
    `SELECT m.code, p.code AS parent_code
       FROM catalogs_modules m LEFT JOIN catalogs_modules p ON p.id = m.module_parent_id WHERE m.id = $1`,
    [params.id]
  );
  if (!mod) throw notFound("Módulo no encontrado");

  const isSecurityTree = mod.code === "ADMIN" || mod.parent_code === "ADMIN" || mod.code === "DASHBOARD";
  const hides = body.isOffline === true || [body.isShowDev, body.isShowQa, body.isShowProd].includes(false);
  if (isSecurityTree && hides) {
    throw forbidden("PROTECTED_MODULE", "Tablero y Seguridad no se pueden apagar ni ocultar");
  }

  await withTx(txCtx(req), (client) =>
    client.query(
      `UPDATE catalogs_modules
          SET name = COALESCE($2, name), description = COALESCE($3, description),
              is_offline = COALESCE($4, is_offline), is_show_dev = COALESCE($5, is_show_dev),
              is_show_qa = COALESCE($6, is_show_qa), is_show_prod = COALESCE($7, is_show_prod),
              updated_by = fn_current_app_user()
        WHERE id = $1`,
      [
        params.id,
        body.name ?? null,
        body.description ?? null,
        body.isOffline ?? null,
        body.isShowDev ?? null,
        body.isShowQa ?? null,
        body.isShowProd ?? null
      ]
    )
  );
  return one(
    `SELECT ${COLUMNS} FROM catalogs_modules m LEFT JOIN catalogs_modules p ON p.id = m.module_parent_id
      WHERE m.id = $1`,
    [params.id]
  );
});
