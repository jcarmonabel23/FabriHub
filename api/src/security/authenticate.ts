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
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { config } from "../config.js";
import { one, query } from "../db.js";
import { forbidden, unauthorized } from "../lib/http.js";
import { verifyAccessToken } from "./tokens.js";

interface SessionRow {
  user_id: string;
  email: string;
  names: string;
  must_change_password: boolean;
  idle: boolean;
}

export function authenticate(options: { allowPendingPasswordChange?: boolean } = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") ?? "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) throw unauthorized("TOKEN_MISSING", "Debe iniciar sesión");

      const claims = verifyAccessToken(token);
      if (!claims) throw unauthorized("TOKEN_INVALID", "Su sesión expiró");

      const row = await one<SessionRow>(
        `SELECT u.id AS user_id, u.email, u.names, u.must_change_password,
                s.last_used_at < NOW() - make_interval(mins => $3) AS idle
           FROM users_sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.id = $1 AND s.user_id = $2
            AND s.revoked_at IS NULL AND s.expires_at > NOW()
            AND u.is_active`,
        [claims.sid, claims.sub, config.SESSION_IDLE_MINUTES]
      );
      if (!row) throw unauthorized("SESSION_REVOKED", "Su sesión ya no es válida");
      if (row.idle) throw unauthorized("SESSION_IDLE", "Su sesión se cerró por inactividad");

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
        mustChangePassword: row.must_change_password
      };

      if (row.must_change_password && !options.allowPendingPasswordChange) {
        throw forbidden("PASSWORD_CHANGE_REQUIRED", "Debe cambiar su contraseña antes de continuar");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
