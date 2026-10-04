/**
 * @project FabriHub - API
 * @file src/modules/admin/users.ts
 * @description Administración de usuarios (módulo ADM_USERS)
 *
 * @overview
 * Permisos por acción:
 *   view       → listar, ver detalle, ver sesiones
 *   add_new    → crear (contraseña temporal por correo, cambio obligatorio al entrar)
 *   edit       → nombre y activación
 *   configure  → asignar módulos/roles, desbloquear, reiniciar contraseña, cerrar sesiones
 *
 * Protecciones anti-bloqueo: nadie puede desactivarse a sí mismo ni quitarse su propio
 * acceso de configuración a ADM_USERS.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { badRequest, conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { sendTemporaryPassword } from "../../lib/mailer.js";
import { hashPassword, setPassword } from "../../lib/passwords.js";
import { authOf, txCtx } from "../../security/context.js";
import { revokeAllSessions } from "../auth/service.js";

const MODULE = "ADM_USERS";
export { MODULE as USERS_MODULE };

// ------------------------------------------------------------------ Listado

const listQuery = pageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "inactive", "locked", "pending"]).optional()
});

export const listUsers = handler({ query: listQuery }, async ({ query: q }) => {
  const rows = await query(
    `SELECT u.id, u.email, u.names, u.is_active AS "isActive", u.must_change_password AS "mustChangePassword",
            u.locked_until AS "lockedUntil", u.last_login_at AS "lastLoginAt", u.logins, u.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM users_modules um WHERE um.user_id = u.id AND um.is_active) AS "modulesCount",
            (SELECT COUNT(*)::int FROM users_sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS "activeSessions",
            COUNT(*) OVER()::int AS total
       FROM users u
      WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%' OR u.names ILIKE '%' || $1 || '%')
        AND (
              $2::text IS NULL
           OR ($2 = 'active'   AND u.is_active)
           OR ($2 = 'inactive' AND NOT u.is_active)
           OR ($2 = 'locked'   AND u.locked_until > NOW())
           OR ($2 = 'pending'  AND u.must_change_password)
        )
      ORDER BY u.names
      LIMIT $3 OFFSET $4`,
    [q.search || null, q.status ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

// ------------------------------------------------------------------ Detalle

async function userDetail(id: string) {
  const user = await one(
    `SELECT id, email, names, is_active AS "isActive", must_change_password AS "mustChangePassword",
            locked_until AS "lockedUntil", failed_attempts AS "failedAttempts", last_login_at AS "lastLoginAt",
            logins, password_changed_at AS "passwordChangedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = $1`,
    [id]
  );
  if (!user) throw notFound("Usuario no encontrado");
  const assignments = await query(
    `SELECT m.code AS "moduleCode", m.name AS "moduleName", um.role_ids AS "roleIds",
            um.permissions, ep.permissions AS "effective"
       FROM users_modules um
       JOIN catalogs_modules m ON m.id = um.module_id
       LEFT JOIN v_users_effective_permissions ep ON ep.user_id = um.user_id AND ep.module_id = um.module_id
      WHERE um.user_id = $1 AND um.is_active
      ORDER BY m.code`,
    [id]
  );
  const warehouses = await query(
    `SELECT w.id, w.code, w.name FROM users_warehouses uw JOIN warehouses w ON w.id = uw.warehouse_id
      WHERE uw.user_id = $1 ORDER BY w.order_list, w.code`,
    [id]
  );
  return { ...user, assignments, warehouses };
}

export const getUser = handler({ params: idParams }, ({ params }) => userDetail(params.id));

// ------------------------------------------------------------------ Catálogos para el formulario de asignación

export const userLookups = handler({}, async () => {
  const [roles, modules, permissions] = await Promise.all([
    query(
      `SELECT id, slug, name, description, permissions FROM catalogs_roles WHERE is_active ORDER BY order_list, name`
    ),
    query(
      `SELECT m.code, m.name, m.is_offline AS "isOffline", p.code AS "parentCode", p.name AS "parentName"
         FROM catalogs_modules m JOIN catalogs_modules p ON p.id = m.module_parent_id
        WHERE m.is_active
        ORDER BY p.order_list, m.order_list`
    ),
    query(`SELECT slug, name, description FROM catalogs_permissions WHERE is_active ORDER BY order_list`)
  ]);
  return { roles, modules, permissions };
});

// ------------------------------------------------------------------ Alta

const createBody = z.object({
  email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
  names: z.string().trim().min(3).max(120)
});

export const createUser = handler({ body: createBody }, async ({ body, req }) => {
  const exists = await one(`SELECT 1 FROM users WHERE email = $1`, [body.email]);
  if (exists) throw conflict("EMAIL_TAKEN", "Ya existe un usuario con ese correo");

  const temp = temporaryPassword();
  const hash = await hashPassword(temp);
  const created = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `INSERT INTO users (email, names, password_hash, must_change_password, created_by, updated_by)
       VALUES ($1, $2, $3, TRUE, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [body.email, body.names, hash],
      client
    )
  );
  await sendTemporaryPassword(body.email, body.names, temp);
  req.res?.status(201);
  return userDetail(created!.id);
});

// ------------------------------------------------------------------ Edición

const updateBody = z
  .object({
    names: z.string().trim().min(3).max(120).optional(),
    isActive: z.boolean().optional()
  })
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

export const updateUser = handler({ params: idParams, body: updateBody }, async ({ params, body, req }) => {
  const auth = authOf(req);
  if (params.id === auth.userId && body.isActive === false) {
    throw forbidden("SELF_LOCKOUT", "No puede desactivar su propia cuenta");
  }
  await withTx(txCtx(req), async (client) => {
    const updated = await one(
      `UPDATE users SET names = COALESCE($2, names), is_active = COALESCE($3, is_active),
              updated_by = fn_current_app_user()
        WHERE id = $1 RETURNING id`,
      [params.id, body.names ?? null, body.isActive ?? null],
      client
    );
    if (!updated) throw notFound("Usuario no encontrado");
    if (body.isActive === false) await revokeAllSessions(client, params.id, "deactivated");
  });
  return userDetail(params.id);
});

// ------------------------------------------------------------------ Seguridad de la cuenta

export const unlockUser = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const row = await one(
      `UPDATE users SET locked_until = NULL, failed_attempts = 0, updated_by = fn_current_app_user()
        WHERE id = $1 RETURNING id`,
      [params.id],
      client
    );
    if (!row) throw notFound("Usuario no encontrado");
  });
  await logAuth(req, "admin_unlock", true, { userId: params.id, detail: { by: authOf(req).userId } });
  return userDetail(params.id);
});

export const adminResetPassword = handler({ params: idParams }, async ({ params, req }) => {
  const auth = authOf(req);
  if (params.id === auth.userId) {
    throw badRequest("USE_CHANGE_PASSWORD", "Para su propia cuenta use Cambiar contraseña");
  }
  const user = await one<{ email: string; names: string; password_hash: string }>(
    `SELECT email, names, password_hash FROM users WHERE id = $1`,
    [params.id]
  );
  if (!user) throw notFound("Usuario no encontrado");

  const temp = temporaryPassword();
  await withTx(txCtx(req), async (client) => {
    await setPassword(client, params.id, user.password_hash, temp, true);
    await revokeAllSessions(client, params.id, "admin");
  });
  await sendTemporaryPassword(user.email, user.names, temp);
  await logAuth(req, "admin_reset", true, { userId: params.id, email: user.email, detail: { by: auth.userId } });
  return { message: `Se envió una contraseña temporal a ${user.email}` };
});

export const listSessions = handler({ params: idParams }, ({ params }) =>
  query(
    `SELECT id, ip_address AS "ipAddress", user_agent AS "userAgent", created_at AS "createdAt",
            last_used_at AS "lastUsedAt", expires_at AS "expiresAt", revoked_at AS "revokedAt",
            revoke_reason AS "revokeReason", rotations
       FROM users_sessions WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [params.id]
  )
);

export const revokeSessions = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), (client) => revokeAllSessions(client, params.id, "admin"));
  await logAuth(req, "admin_revoke_sessions", true, { userId: params.id, detail: { by: authOf(req).userId } });
  return undefined;
});

// ------------------------------------------------------------------ Asignación de módulos (RBAC)

const assignmentsBody = z.object({
  assignments: z
    .array(
      z.object({
        moduleCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        roleIds: z.array(z.uuid()).max(10).default([]),
        permissions: z.array(z.string().regex(/^[a-z_]+$/)).max(20).default([])
      })
    )
    .max(200)
});

export const setUserModules = handler({ params: idParams, body: assignmentsBody }, async ({ params, body, req }) => {
  const auth = authOf(req);
  const codes = body.assignments.map((a) => a.moduleCode);
  if (new Set(codes).size !== codes.length) throw badRequest("DUPLICATED_MODULE", "Hay módulos repetidos");

  const [modules, roles, perms] = await Promise.all([
    query<{ id: string; code: string }>(
      `SELECT id, code FROM catalogs_modules WHERE code = ANY($1) AND module_parent_id IS NOT NULL`,
      [codes]
    ),
    query<{ id: string; permissions: string[] }>(`SELECT id, permissions FROM catalogs_roles WHERE is_active`),
    query<{ slug: string }>(`SELECT slug FROM catalogs_permissions WHERE is_active`)
  ]);
  const moduleId = new Map(modules.map((m) => [m.code, m.id]));
  const roleMap = new Map(roles.map((r) => [r.id, r.permissions]));
  const slugs = new Set(perms.map((p) => p.slug));

  for (const a of body.assignments) {
    if (!moduleId.has(a.moduleCode)) throw badRequest("INVALID_MODULE", `Módulo no asignable: ${a.moduleCode}`);
    for (const r of a.roleIds) if (!roleMap.has(r)) throw badRequest("INVALID_ROLE", "Rol inexistente o inactivo");
    for (const p of a.permissions) if (!slugs.has(p)) throw badRequest("INVALID_PERMISSION", `Permiso inexistente: ${p}`);
  }

  // Anti-bloqueo: quien se edita a sí mismo debe conservar access + configure en ADM_USERS.
  if (params.id === auth.userId) {
    const own = body.assignments.find((a) => a.moduleCode === MODULE);
    const effective = new Set([...(own?.permissions ?? []), ...(own?.roleIds ?? []).flatMap((r) => roleMap.get(r) ?? [])]);
    if (!effective.has("access") || !effective.has("configure")) {
      throw forbidden("SELF_LOCKOUT", "No puede quitarse su propio acceso de configuración a Usuarios");
    }
  }

  await withTx(txCtx(req), async (client) => {
    const target = await one(`SELECT 1 FROM users WHERE id = $1`, [params.id], client);
    if (!target) throw notFound("Usuario no encontrado");

    await client.query(
      `DELETE FROM users_modules WHERE user_id = $1 AND NOT (module_id = ANY($2::uuid[]))`,
      [params.id, [...moduleId.values()]]
    );
    for (const a of body.assignments) {
      await client.query(
        `INSERT INTO users_modules (user_id, module_id, role_ids, permissions, created_by, updated_by)
         VALUES ($1, $2, $3, $4, fn_current_app_user(), fn_current_app_user())
         ON CONFLICT (user_id, module_id) DO UPDATE
            SET role_ids = EXCLUDED.role_ids, permissions = EXCLUDED.permissions,
                is_active = TRUE, updated_by = fn_current_app_user()`,
        [params.id, moduleId.get(a.moduleCode), JSON.stringify(a.roleIds), JSON.stringify(a.permissions)]
      );
    }
  });
  return userDetail(params.id);
});

// ------------------------------------------------------------------ Alcance por almacén (fase 3)

/** Almacenes que ve y mueve el usuario cuando no tiene `view_all` en los módulos de inventario */
export const setUserWarehouses = handler(
  { params: idParams, body: z.object({ warehouseIds: z.array(z.uuid()).max(100) }) },
  async ({ params, body, req }) => {
    const ids = [...new Set(body.warehouseIds)];
    await withTx(txCtx(req), async (client) => {
      if (!(await one(`SELECT 1 FROM users WHERE id = $1`, [params.id], client))) throw notFound("Usuario no encontrado");
      const valid = await query<{ id: string }>(`SELECT id FROM warehouses WHERE id = ANY($1)`, [ids], client);
      if (valid.length !== ids.length) throw badRequest("INVALID_WAREHOUSE", "Algún almacén no existe");
      await client.query(
        `DELETE FROM users_warehouses WHERE user_id = $1 AND NOT (warehouse_id = ANY($2::uuid[]))`,
        [params.id, ids]
      );
      for (const w of ids) {
        await client.query(
          `INSERT INTO users_warehouses (user_id, warehouse_id, created_by) VALUES ($1, $2, fn_current_app_user())
           ON CONFLICT DO NOTHING`,
          [params.id, w]
        );
      }
    });
    return userDetail(params.id);
  }
);
