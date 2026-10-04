/**
 * @project FabriHub - API
 * @file src/lib/passwords.ts
 * @description Política de contraseñas, hash bcrypt e historial anti-reutilización
 */

import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { query, type Db } from "../db.js";
import { badRequest } from "./http.js";

/** Hash fijo para comparar cuando el correo no existe (iguala el tiempo de respuesta) */
const DUMMY_HASH = bcrypt.hashSync("fabrihub-dummy-password", 10);

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, config.BCRYPT_COST);

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH);
}

/**
 * @function passwordPolicyErrors
 * @description Reglas: 10+ caracteres, mayúscula, minúscula, número, símbolo y sin contener el usuario del correo
 * @returns Lista de reglas incumplidas (vacía = válida)
 */
export function passwordPolicyErrors(password: string, email?: string): string[] {
  const errors: string[] = [];
  if (password.length < 10) errors.push("Debe tener al menos 10 caracteres");
  if (password.length > 128) errors.push("No puede superar 128 caracteres");
  if (!/[A-Z]/.test(password)) errors.push("Debe incluir una letra mayúscula");
  if (!/[a-z]/.test(password)) errors.push("Debe incluir una letra minúscula");
  if (!/\d/.test(password)) errors.push("Debe incluir un número");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Debe incluir un símbolo");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    errors.push("No puede contener su usuario de correo");
  }
  return errors;
}

export function assertPasswordPolicy(password: string, email?: string): void {
  const errors = passwordPolicyErrors(password, email);
  if (errors.length > 0) throw badRequest("PASSWORD_POLICY", "La contraseña no cumple la política", errors);
}

/**
 * @function assertNotReused
 * @description Rechaza la contraseña si coincide con la vigente o con alguna de las últimas N
 */
export async function assertNotReused(db: Db, userId: string, currentHash: string, plain: string): Promise<void> {
  const history = await query<{ password_hash: string }>(
    `SELECT password_hash FROM users_passwords_history
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, config.PASSWORD_HISTORY - 1],
    db
  );
  for (const hash of [currentHash, ...history.map((h) => h.password_hash)]) {
    if (await bcrypt.compare(plain, hash)) {
      throw badRequest(
        "PASSWORD_REUSED",
        `No puede reutilizar ninguna de sus últimas ${config.PASSWORD_HISTORY} contraseñas`
      );
    }
  }
}

/**
 * @function setPassword
 * @description Archiva la contraseña vigente en el historial y guarda la nueva
 */
export async function setPassword(
  db: Db,
  userId: string,
  currentHash: string,
  plain: string,
  mustChange: boolean
): Promise<void> {
  const newHash = await hashPassword(plain);
  await query(`INSERT INTO users_passwords_history (user_id, password_hash) VALUES ($1, $2)`, [userId, currentHash], db);
  await query(
    `UPDATE users
        SET password_hash = $2, must_change_password = $3, password_changed_at = NOW(),
            failed_attempts = 0, locked_until = NULL, updated_by = fn_current_app_user()
      WHERE id = $1`,
    [userId, newHash, mustChange],
    db
  );
}
