/**
 * @project FabriHub - API
 * @file src/modules/auth/logout.ts
 * @description POST /auth/logout (esta sesión, vía cookie) y POST /auth/logout-all (todas)
 */

import { query, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { sha256 } from "../../lib/crypto.js";
import { handler } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";
import { REFRESH_COOKIE, clearRefreshCookie } from "../../security/tokens.js";
import { revokeAllSessions } from "./service.js";

/** No exige access token vigente: basta la cookie, así el logout funciona aunque el JWT haya vencido */
export const logout = handler({}, async ({ req, res }) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) {
    const rows = await query<{ user_id: string }>(
      `UPDATE users_sessions SET revoked_at = NOW(), revoke_reason = 'logout'
        WHERE refresh_hash = $1 AND revoked_at IS NULL RETURNING user_id`,
      [sha256(token)]
    );
    if (rows[0]) await logAuth(req, "logout", true, { userId: rows[0].user_id });
  }
  clearRefreshCookie(res);
  return undefined;
});

export const logoutAll = handler({}, async ({ req, res }) => {
  const auth = authOf(req);
  await withTx(txCtx(req), (client) => revokeAllSessions(client, auth.userId, "logout_all"));
  await logAuth(req, "logout_all", true, { userId: auth.userId, email: auth.email });
  clearRefreshCookie(res);
  return undefined;
});
