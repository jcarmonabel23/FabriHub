/**
 * @project FabriHub - API
 * @file src/security/authenticate.ts
 * @description Middleware de autenticación: JWT válido + sesión viva + usuario activo
 *
 * @overview
 * El JWT por sí solo NO basta: en cada petición se comprueba contra la BD que la sesión
 * (claim sid) no esté revocada, vencida ni inactiva, y que el usuario siga activo.
 * Así un logout, una desactivación o un "cerrar todas las sesiones" surte efecto al
 * instante, sin esperar a que venza el access token.
 *
 * Si el usuario debe cambiar su contraseña, solo se le deja pasar a las rutas que
 * declaran `allowPendingPasswordChange` (me, change-password, logout).
 *
 * La sesión trae su empresa activa: debe seguir activa y el usuario seguir perteneciendo
 * a ella. Si ya no (empresa suspendida, acceso retirado), la sesión pasa sola a otra empresa
 * del usuario; sin ninguna, 403 NO_COMPANY. El resto de la petición corre dentro de
 * runInCompany (RLS por empresa).
 *
 * El front envía la empresa con la que pintó la pantalla (x-company-id). Si la sesión cambió
 * de empresa en otra pestaña, 409 COMPANY_CHANGED: así nada se guarda en la empresa equivocada.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { config } from "../config.js";
import { one, query, runInCompany } from "../db.js";
import { conflict, forbidden, unauthorized } from "../lib/http.js";
import { verifyAccessToken } from "./tokens.js";

interface SessionRow {
  user_id: string;
  email: string;
  names: string;
  must_change_password: boolean;
  idle: boolean;
  company_id: string | null;
  is_platform_admin: boolean;
}

/** Empresa a la que pasa una sesión cuya empresa ya no es válida (la por defecto, o la primera activa) */
async function fallbackCompany(sessionId: string, userId: string): Promise<string | null> {
  const row = await one<{ company_id: string | null }>(
    `UPDATE users_sessions SET company_id =
            (SELECT uc.company_id FROM users_companies uc JOIN companies c ON c.id = uc.company_id AND c.is_active
              WHERE uc.user_id = $2 AND uc.is_active
              ORDER BY uc.is_default DESC, uc.created_at LIMIT 1)
      WHERE id = $1 RETURNING company_id`,
    [sessionId, userId]
  );
  return row?.company_id ?? null;
}

export function authenticate(
  options: { allowPendingPasswordChange?: boolean; ignoreCompanyHeader?: boolean } = {}
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") ?? "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) throw unauthorized("TOKEN_MISSING", "Debe iniciar sesión");

      const claims = verifyAccessToken(token);
      if (!claims) throw unauthorized("TOKEN_INVALID", "Su sesión expiró");

      const row = await one<SessionRow>(
        `SELECT u.id AS user_id, u.email, u.names, u.must_change_password, u.is_platform_admin,
                s.last_used_at < NOW() - make_interval(mins => $3) AS idle,
                c.id AS company_id
           FROM users_sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN users_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id AND uc.is_active
           LEFT JOIN companies c ON c.id = uc.company_id AND c.is_active
          WHERE s.id = $1 AND s.user_id = $2
            AND s.revoked_at IS NULL AND s.expires_at > NOW()
            AND u.is_active`,
        [claims.sid, claims.sub, config.SESSION_IDLE_MINUTES]
      );
      if (!row) throw unauthorized("SESSION_REVOKED", "Su sesión ya no es válida");
      if (row.idle) throw unauthorized("SESSION_IDLE", "Su sesión se cerró por inactividad");
      const companyId = row.company_id ?? (await fallbackCompany(claims.sid, row.user_id));
      if (!companyId) throw forbidden("NO_COMPANY", "Su usuario no tiene acceso a una empresa activa");

      const expected = req.get("x-company-id");
      if (expected && expected !== companyId && !options.ignoreCompanyHeader) {
        throw conflict("COMPANY_CHANGED", "La sesión cambió de empresa en otra pestaña; recargue la página");
      }

      // Marca actividad como mucho una vez por minuto (evita un UPDATE por petición).
      await query(
        `UPDATE users_sessions SET last_used_at = NOW()
          WHERE id = $1 AND last_used_at < NOW() - INTERVAL '1 minute'`,
        [claims.sid]
      );

      req.auth = {
        userId: row.user_id,
        sessionId: claims.sid,
        email: row.email,
        names: row.names,
        mustChangePassword: row.must_change_password,
        companyId,
        isPlatformAdmin: row.is_platform_admin
      };

      if (row.must_change_password && !options.allowPendingPasswordChange) {
        throw forbidden("PASSWORD_CHANGE_REQUIRED", "Debe cambiar su contraseña antes de continuar");
      }

      runInCompany(companyId, () => next());
    } catch (err) {
      next(err);
    }
  };
}
