/**
 * @project FabriHub - API
 * @file src/modules/auth/changePassword.ts
 * @description POST /auth/change-password — cambio por el propio usuario (obligatorio en primer ingreso)
 *
 * @overview
 * Exige la contraseña actual, aplica política e historial y cierra las DEMÁS sesiones del
 * usuario (la actual sigue viva para no sacarlo de la pantalla).
 */

import { z } from "zod";
import { one, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { HttpError, handler } from "../../lib/http.js";
import { assertNotReused, assertPasswordPolicy, setPassword, verifyPassword } from "../../lib/passwords.js";
import { authOf, txCtx } from "../../security/context.js";
import { revokeAllSessions, sessionPayload } from "./service.js";

const body = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128)
});

export const changePassword = handler({ body }, async ({ body, req }) => {
  const auth = authOf(req);

  const user = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [auth.userId]);
  if (!user || !(await verifyPassword(body.currentPassword, user.password_hash))) {
    await logAuth(req, "password_change", false, { userId: auth.userId, email: auth.email, detail: { reason: "bad_current" } });
    throw new HttpError(400, "INVALID_CURRENT_PASSWORD", "La contraseña actual no es correcta");
  }
  if (body.currentPassword === body.newPassword) {
    throw new HttpError(400, "PASSWORD_REUSED", "La nueva contraseña debe ser distinta de la actual");
  }
  assertPasswordPolicy(body.newPassword, auth.email);

  await withTx(txCtx(req), async (client) => {
    await assertNotReused(client, auth.userId, user.password_hash, body.newPassword);
    await setPassword(client, auth.userId, user.password_hash, body.newPassword, false);
    await revokeAllSessions(client, auth.userId, "password_change", auth.sessionId);
  });
  await logAuth(req, "password_change", true, { userId: auth.userId, email: auth.email });

  return sessionPayload({ id: auth.userId, email: auth.email, names: auth.names, mustChangePassword: false });
});
