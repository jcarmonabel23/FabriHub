/**
 * @project FabriHub - API
 * @file src/modules/auth/otpVerify.ts
 * @description POST /auth/otp/verify — paso 2 del login: código OTP → abre la sesión
 */

import { z } from "zod";
import { one, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { HttpError, handler } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { USER_COLUMNS, checkOtp, openSession, type OtpRow, type UserRow } from "./service.js";

const body = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos")
});

const EXPIRED = new HttpError(401, "OTP_EXPIRED", "El código venció o ya no es válido. Inicie sesión de nuevo.");

export const otpVerify = handler({ body }, async ({ body, req, res }) => {
  // El intento fallido debe quedar guardado: la transacción devuelve el error en vez de
  // lanzarlo dentro (un throw haría ROLLBACK y el contador de intentos nunca subiría).
  const result = await withTx(txCtx(req), async (client) => {
    const otp = await one<OtpRow>(
      `SELECT id, user_id, code_hash, attempts, sends, last_sent_at, expires_at
         FROM users_otp
        WHERE id = $1 AND purpose = 'login' AND consumed_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [body.challengeId],
      client
    );
    if (!otp) throw EXPIRED;

    const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [otp.user_id], client);
    if (!user || !user.is_active || (user.locked_until && user.locked_until > new Date())) throw EXPIRED;

    const check = await checkOtp(client, otp, body.code);
    if (!check.ok) {
      await logAuth(req, "otp_verify", false, { userId: user.id, email: user.email, detail: { reason: check.reason } }, client);
      return { error: check };
    }

    await client.query(`UPDATE users SET logins = logins + 1, last_login_at = NOW() WHERE id = $1`, [user.id]);
    await logAuth(req, "otp_verify", true, { userId: user.id, email: user.email }, client);

    const session = await openSession(client, req, res, {
      id: user.id,
      email: user.email,
      names: user.names,
      mustChangePassword: user.must_change_password
    });
    return { session };
  });

  if ("error" in result && result.error && !result.error.ok) {
    if (result.error.reason === "locked") {
      throw new HttpError(401, "OTP_LOCKED", "Demasiados intentos. Inicie sesión de nuevo para recibir otro código.");
    }
    throw new HttpError(401, "OTP_INVALID", `Código incorrecto. Le quedan ${result.error.remaining} intento(s).`);
  }
  return "session" in result ? result.session : undefined;
});
