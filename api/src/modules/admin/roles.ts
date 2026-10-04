/**
 * @project FabriHub - API
 * @file src/modules/admin/roles.ts
 * @description Administración de roles y consulta del catálogo de permisos (módulo ADM_ROLES)
 *
 * @overview
 * - Los roles semilla (is_system) no se eliminan ni cambian de slug.
 * - El rol `admin` conserva siempre todos los permisos: es la llave maestra que evita
 *   dejar el sistema sin nadie capaz de administrarlo.
 * - Un rol en uso (asignado a algún usuario) no se puede eliminar: primero se desasigna.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, forbidden, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

export const ROLES_MODULE = "ADM_ROLES";

const ROLE_COLUMNS = `r.id, r.slug, r.name, r.description, r.permissions, r.is_active AS "isActive",
  r.is_system AS "isSystem", r.order_list AS "orderList", r.updated_at AS "updatedAt",
  (SELECT COUNT(DISTINCT um.user_id)::int FROM users_modules um WHERE um.role_ids ? r.id::text) AS "usersCount"`;

export const listRoles = handler({}, () =>
  query(`SELECT ${ROLE_COLUMNS} FROM catalogs_roles r ORDER BY r.order_list, r.name`)
);

export const listPermissions = handler({}, () =>
  query(`SELECT slug, name, description FROM catalogs_permissions WHERE is_active ORDER BY order_list`)
);

async function assertSlugs(permissions: string[]): Promise<void> {
  const valid = await query<{ slug: string }>(`SELECT slug FROM catalogs_permissions WHERE is_active`);
  const set = new Set(valid.map((v) => v.slug));
  const bad = permissions.filter((p) => !set.has(p));
  if (bad.length) throw badRequest("INVALID_PERMISSION", `Permisos inexistentes: ${bad.join(", ")}`);
  if (permissions.length && !permissions.includes("access")) {
    throw badRequest("ACCESS_REQUIRED", "Todo rol con permisos debe incluir Acceso; sin él los demás no sirven");
  }
}

const permissionsSchema = z.array(z.string().regex(/^[a-z_]+$/)).max(20).transform((p) => [...new Set(p)]);

const createBody = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/, "Solo minúsculas, números y _ (3-40)"),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(400).optional(),
  permissions: permissionsSchema
});

export const createRole = handler({ body: createBody }, async ({ body, req }) => {
  await assertSlugs(body.permissions);
  if (await one(`SELECT 1 FROM catalogs_roles WHERE slug = $1`, [body.slug])) {
    throw conflict("SLUG_TAKEN", "Ya existe un rol con ese identificador");
  }
  const row = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `INSERT INTO catalogs_roles (slug, name, description, permissions, order_list, created_by, updated_by)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM catalogs_roles),
               fn_current_app_user(), fn_current_app_user())
       RETURNING id`,
      [body.slug, body.name, body.description ?? null, JSON.stringify(body.permissions)],
      client
    )
  );
  req.res?.status(201);
  return one(`SELECT ${ROLE_COLUMNS} FROM catalogs_roles r WHERE r.id = $1`, [row!.id]);
});

const updateBody = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    description: z.string().trim().max(400).nullable().optional(),
    permissions: permissionsSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

export const updateRole = handler({ params: idParams, body: updateBody }, async ({ params, body, req }) => {
  const role = await one<{ slug: string }>(`SELECT slug FROM catalogs_roles WHERE id = $1`, [params.id]);
  if (!role) throw notFound("Rol no encontrado");
  if (role.slug === "admin" && (body.permissions !== undefined || body.isActive === false)) {
    throw forbidden("ADMIN_ROLE_LOCKED", "El rol Administrador conserva siempre todos sus permisos");
  }
  if (body.permissions) await assertSlugs(body.permissions);

  await withTx(txCtx(req), (client) =>
    client.query(
      `UPDATE catalogs_roles
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              permissions = COALESCE($5::jsonb, permissions),
              is_active = COALESCE($6, is_active),
              updated_by = fn_current_app_user()
        WHERE id = $1`,
      [
        params.id,
        body.name ?? null,
        body.description !== undefined,
        body.description ?? null,
        body.permissions ? JSON.stringify(body.permissions) : null,
        body.isActive ?? null
      ]
    )
  );
  return one(`SELECT ${ROLE_COLUMNS} FROM catalogs_roles r WHERE r.id = $1`, [params.id]);
});

export const deleteRole = handler({ params: idParams }, async ({ params, req }) => {
  const role = await one<{ is_system: boolean; in_use: boolean }>(
    `SELECT r.is_system, EXISTS (SELECT 1 FROM users_modules um WHERE um.role_ids ? r.id::text) AS in_use
       FROM catalogs_roles r WHERE r.id = $1`,
    [params.id]
  );
  if (!role) throw notFound("Rol no encontrado");
  if (role.is_system) throw forbidden("SYSTEM_ROLE", "Los roles del sistema no se eliminan; puede desactivarlos");
  if (role.in_use) throw conflict("ROLE_IN_USE", "El rol está asignado a usuarios; desasígnelo primero");
  await withTx(txCtx(req), (client) => client.query(`DELETE FROM catalogs_roles WHERE id = $1`, [params.id]));
  return undefined;
});
