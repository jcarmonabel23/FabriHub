/**
 * @project FabriHub - API
 * @file src/modules/admin/members.ts
 * @description Pertenencia de usuarios a empresas: agregar (existente o nuevo) y retirar
 *
 * @overview
 * Se ejecuta dentro de un withTx cuya empresa activa es la empresa destino: los permisos
 * (users_modules) y el alcance por almacén (users_warehouses) están aislados por RLS, así que
 * solo se tocan los de esa empresa. Los correos se envían DESPUÉS del commit (quien llama).
 */

import type pg from "pg";
import { one, query } from "../../db.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { badRequest, conflict } from "../../lib/http.js";
import { hashPassword } from "../../lib/passwords.js";

export interface AddedMember {
  userId: string;
  email: string;
  names: string;
  /** Contraseña temporal si el usuario se creó (hay que enviarla por correo) */
  tempPassword: string | null;
}

/**
 * @function addMember
 * @description Agrega a la empresa activa un usuario por correo; lo crea si no existe.
 * Con `asAdmin`, recibe el rol admin en todos los módulos de empresa (no en los de plataforma).
 */
export async function addMember(
  client: pg.PoolClient,
  input: { email: string; names?: string | null; asAdmin?: boolean }
): Promise<AddedMember> {
  let user = await one<{ id: string; email: string; names: string }>(
    `SELECT id, email::text AS email, names FROM users WHERE email = $1`,
    [input.email],
    client
  );
  let tempPassword: string | null = null;

  if (!user) {
    if (!input.names) throw badRequest("NAMES_REQUIRED", "El usuario no existe: indique su nombre para crearlo");
    tempPassword = temporaryPassword();
    user = await one<{ id: string; email: string; names: string }>(
      `INSERT INTO users (email, names, password_hash, must_change_password, created_by, updated_by)
       VALUES ($1, $2, $3, TRUE, fn_current_app_user(), fn_current_app_user())
       RETURNING id, email::text AS email, names`,
      [input.email, input.names, await hashPassword(tempPassword)],
      client
    );
  } else {
    const member = await one<{ is_active: boolean }>(
      `SELECT is_active FROM users_companies WHERE user_id = $1 AND company_id = fn_current_company()`,
      [user.id],
      client
    );
    if (member?.is_active) throw conflict("ALREADY_MEMBER", "Ese usuario ya pertenece a la empresa");
  }

  await client.query(
    `INSERT INTO users_companies (user_id, company_id, is_default, created_by, updated_by)
     VALUES ($1, fn_current_company(), NOT EXISTS (SELECT 1 FROM users_companies WHERE user_id = $1 AND is_default),
             fn_current_app_user(), fn_current_app_user())
     ON CONFLICT (user_id, company_id) DO UPDATE SET is_active = TRUE, updated_by = fn_current_app_user()`,
    [user!.id]
  );

  if (input.asAdmin) {
    await client.query(
      `INSERT INTO users_modules (user_id, module_id, role_ids, created_by, updated_by)
       SELECT $1, m.id, jsonb_build_array((SELECT id::text FROM catalogs_roles WHERE slug = 'admin')),
              fn_current_app_user(), fn_current_app_user()
         FROM catalogs_modules m
        WHERE m.module_parent_id IS NOT NULL AND m.scope <> 'platform'
       ON CONFLICT (company_id, user_id, module_id) DO UPDATE
          SET role_ids = EXCLUDED.role_ids, is_active = TRUE, updated_by = fn_current_app_user()`,
      [user!.id]
    );
  }

  return { userId: user!.id, email: user!.email, names: user!.names, tempPassword };
}

/**
 * @function removeMember
 * @description Retira al usuario de la empresa activa: su pertenencia, permisos y almacenes en ella.
 * Si era su empresa por defecto, pasa a serlo otra de las suyas. Sus sesiones abiertas en esta
 * empresa pasan solas a otra (o quedan sin acceso) en la siguiente petición.
 */
export async function removeMember(client: pg.PoolClient, userId: string): Promise<boolean> {
  const removed = await one<{ is_default: boolean }>(
    `DELETE FROM users_companies WHERE user_id = $1 AND company_id = fn_current_company() RETURNING is_default`,
    [userId],
    client
  );
  if (!removed) return false;

  await query(`DELETE FROM users_modules WHERE user_id = $1`, [userId], client);
  await query(`DELETE FROM users_warehouses WHERE user_id = $1`, [userId], client);
  if (removed.is_default) {
    await client.query(
      `UPDATE users_companies SET is_default = TRUE
        WHERE id = (SELECT id FROM users_companies WHERE user_id = $1 AND is_active ORDER BY created_at LIMIT 1)`,
      [userId]
    );
  }
  return true;
}
