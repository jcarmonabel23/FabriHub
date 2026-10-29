/**
 * @project FabriHub - API
 * @file src/modules/pos/supervisor.ts
 * @description Clave de supervisor del POS: autoriza descuentos sobre el límite y anulaciones
 *
 * @overview
 * Supervisor = usuario con el permiso `approve` en POS_SALES dentro de la empresa activa.
 * Si quien opera la caja ya lo tiene, no se pide nada; si no, un supervisor se identifica en
 * la caja con su usuario y su clave corta (4 a 8 dígitos, bcrypt). Cinco fallos seguidos la
 * bloquean 15 minutos. La verificación corre FUERA de la transacción de la venta: así el
 * contador de fallos no se pierde cuando la venta se rechaza.
 */

import type { Request } from "express";
import { z } from "zod";
import { one, query } from "../../db.js";
import { HttpError, badRequest, forbidden, handler } from "../../lib/http.js";
import { hashPassword, verifyPassword } from "../../lib/passwords.js";
import { modulePermissions } from "../../security/authorize.js";
import { authOf } from "../../security/context.js";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export const supervisorSchema = z.object({
  userId: z.uuid(),
  pin: z.string().regex(/^\d{4,8}$/, "La clave de supervisor tiene de 4 a 8 dígitos")
});
export type SupervisorInput = z.infer<typeof supervisorSchema>;

async function isSupervisor(userId: string): Promise<boolean> {
  const row = await modulePermissions(userId, "POS_SALES");
  const granted = row?.permissions ?? [];
  return Boolean(row?.visible) && granted.includes("access") && granted.includes("approve");
}

/**
 * @function authorizeSupervisor
 * @description Devuelve quién autoriza `what`: el propio usuario si es supervisor o el supervisor
 * que se identificó con su clave. Sin autorización válida lanza 403 SUPERVISOR_REQUIRED.
 */
export async function authorizeSupervisor(req: Request, supervisor: SupervisorInput | null | undefined, what: string): Promise<string> {
  const me = authOf(req).userId;
  if (await isSupervisor(me)) return me;
  if (!supervisor) throw forbidden("SUPERVISOR_REQUIRED", `${what} requiere la autorización de un supervisor`);

  const u = await one<{ is_active: boolean; pos_pin_hash: string | null; locked: boolean; member: boolean }>(
    `SELECT u.is_active, u.pos_pin_hash, COALESCE(u.pos_pin_locked_until > NOW(), FALSE) AS locked,
            EXISTS (SELECT 1 FROM users_companies uc WHERE uc.user_id = u.id AND uc.company_id = fn_current_company() AND uc.is_active) AS member
       FROM users u WHERE u.id = $1`,
    [supervisor.userId]
  );
  // Mismo tiempo de respuesta exista o no el usuario (verifyPassword compara contra un hash fijo)
  const ok = await verifyPassword(supervisor.pin, u?.pos_pin_hash);
  if (!u || !u.is_active || !u.member || !u.pos_pin_hash || !(await isSupervisor(supervisor.userId))) {
    throw forbidden("INVALID_SUPERVISOR", "Supervisor o clave no válidos");
  }
  if (u.locked) throw new HttpError(423, "SUPERVISOR_LOCKED", `La clave de ese supervisor está bloqueada por intentos fallidos; espere ${LOCK_MINUTES} minutos`);
  if (!ok) {
    await query(
      `UPDATE users SET pos_pin_failures = pos_pin_failures + 1,
              pos_pin_locked_until = CASE WHEN pos_pin_failures + 1 >= $2 THEN NOW() + make_interval(mins => $3) END
        WHERE id = $1`,
      [supervisor.userId, MAX_FAILURES, LOCK_MINUTES]
    );
    throw forbidden("INVALID_SUPERVISOR", "Supervisor o clave no válidos");
  }
  await query(`UPDATE users SET pos_pin_failures = 0, pos_pin_locked_until = NULL WHERE id = $1 AND pos_pin_failures > 0`, [supervisor.userId]);
  return supervisor.userId;
}

/** Supervisores de la empresa activa (para elegir en la caja) */
export const listSupervisors = handler({}, async () =>
  query(
    `SELECT u.id, u.names, (u.pos_pin_hash IS NOT NULL) AS "hasPin"
       FROM users u
       JOIN users_companies uc ON uc.user_id = u.id AND uc.company_id = fn_current_company() AND uc.is_active
       JOIN v_users_effective_permissions ep ON ep.user_id = u.id AND ep.module_code = 'POS_SALES' AND ep.company_id = fn_current_company()
      WHERE u.is_active AND ep.permissions ? 'access' AND ep.permissions ? 'approve'
      ORDER BY u.names`
  )
);

/** El supervisor fija (o cambia) su propia clave; confirma con su contraseña */
export const setMyPin = handler(
  {
    body: z.object({
      password: z.string().min(1).max(128),
      pin: z.string().regex(/^\d{4,8}$/, "La clave tiene de 4 a 8 dígitos")
    })
  },
  async ({ body, req }) => {
    const me = authOf(req).userId;
    if (!(await isSupervisor(me))) throw forbidden("NOT_SUPERVISOR", "Solo los supervisores del POS (permiso Aprobar en ventas de mostrador) tienen clave");
    if (/^(\d)\1+$/.test(body.pin) || "0123456789".includes(body.pin) || "9876543210".includes(body.pin)) {
      throw badRequest("WEAK_PIN", "Use una clave que no sea una secuencia ni un dígito repetido");
    }
    const u = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [me]);
    if (!(await verifyPassword(body.password, u?.password_hash))) throw badRequest("INVALID_PASSWORD", "La contraseña no es correcta");
    await query(`UPDATE users SET pos_pin_hash = $2, pos_pin_failures = 0, pos_pin_locked_until = NULL, updated_by = $1 WHERE id = $1`, [
      me,
      await hashPassword(body.pin)
    ]);
    return undefined;
  }
);
