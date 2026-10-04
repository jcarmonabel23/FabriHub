/**
 * @project FabriHub - API
 * @file src/modules/auth/refresh.ts
 * @description POST /auth/refresh — rota el refresh token (cookie) y emite un access token nuevo
 *
 * @overview
 * Rotación con detección de reuso:
 *  - Refresh vigente → se reemplaza por uno nuevo y se devuelve la sesión con permisos frescos
 *    (un cambio de roles se refleja en el próximo refresh, ≤ 15 min).
 *  - Refresh ANTERIOR presentado segundos después de rotar → carrera entre pestañas: 409, el
 *    front reintenta con la cookie nueva.
 *  - Refresh anterior presentado más tarde → alguien lo copió: se revocan TODAS las sesiones.
 */

import { config } from "../../config.js";
import { one, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { HttpError, handler, unauthorized } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie, signAccessToken } from "../../security/tokens.js";
import { revokeAllSessions, sessionPayload } from "./service.js";

const RACE_GRACE_SECONDS = 15;

interface Row {
  session_id: string;
  user_id: string;
  email: string;
  names: string;
  must_change_password: boolean;
  is_active: boolean;
  expires_at: Date;
  idle: boolean;
  revoked: boolean;
  recently_rotated: boolean;
  matched: "current" | "previous";
}

export const refresh = handler({}, async ({ req, res }) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized("REFRESH_MISSING", "Debe iniciar sesión");
  const hash = sha256(token);

  const outcome = await withTx(txCtx(req), async (client) => {
    const row = await one<Row>(
      `SELECT s.id AS session_id, s.user_id, u.email, u.names, u.must_change_password, u.is_active, s.expires_at,
              s.last_used_at < NOW() - make_interval(mins => $2) AS idle,
              s.revoked_at IS NOT NULL AS revoked,
              COALESCE(s.rotated_at > NOW() - make_interval(secs => $3), FALSE) AS recently_rotated,
              CASE WHEN s.refresh_hash = $1 THEN 'current' ELSE 'previous' END AS matched
         FROM users_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.refresh_hash = $1 OR s.prev_refresh_hash = $1
        FOR UPDATE OF s`,
      [hash, config.SESSION_IDLE_MINUTES, RACE_GRACE_SECONDS],
      client
    );

    if (!row) return { fail: "REFRESH_INVALID" as const };

    if (row.matched === "previous") {
      if (!row.revoked && row.recently_rotated) return { fail: "REFRESH_RACE" as const };
      await revokeAllSessions(client, row.user_id, "reuse");
      await logAuth(req, "refresh_reuse", false, { userId: row.user_id, email: row.email }, client);
      return { fail: "REFRESH_REUSED" as const };
    }

    if (row.revoked || row.expires_at <= new Date() || !row.is_active) return { fail: "REFRESH_INVALID" as const };
    if (row.idle) {
      await client.query(`UPDATE users_sessions SET revoked_at = NOW(), revoke_reason = 'idle' WHERE id = $1`, [
        row.session_id
      ]);
      return { fail: "SESSION_IDLE" as const };
    }

    const next = randomToken();
    await client.query(
      `UPDATE users_sessions
          SET prev_refresh_hash = refresh_hash, refresh_hash = $2, rotations = rotations + 1,
              rotated_at = NOW(), last_used_at = NOW()
        WHERE id = $1`,
      [row.session_id, sha256(next)]
    );
    return { row, next };
  });

  if ("fail" in outcome) {
    if (outcome.fail === "REFRESH_RACE") {
      throw new HttpError(409, "REFRESH_RACE", "Sesión renovada en otra pestaña; reintente");
    }
    clearRefreshCookie(res);
    const message =
      outcome.fail === "SESSION_IDLE" ? "Su sesión se cerró por inactividad" : "Su sesión expiró. Inicie sesión de nuevo.";
    throw unauthorized(outcome.fail, message);
  }

  const { row, next } = outcome;
  setRefreshCookie(res, next, row.expires_at);
  const access = signAccessToken(row.user_id, row.session_id);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    ...(await sessionPayload({
      id: row.user_id,
      email: row.email,
      names: row.names,
      mustChangePassword: row.must_change_password
    }))
  };
});
