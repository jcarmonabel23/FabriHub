/**
 * @project FabriHub - API
 * @file src/modules/auth/passwordReset.ts
 * @description Recuperación de contraseña por código al correo
 *   POST /auth/forgot-password — envía el código (respuesta SIEMPRE igual, exista o no la cuenta)
 *   POST /auth/reset-password  — correo + código + nueva contraseña
 */

import { z } from "zod";
import { config } from "../../config.js";
import { one, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { HttpError, handler } from "../../lib/http.js";
import { sendOtp } from "../../lib/mailer.js";
import { assertNotReused, assertPasswordPolicy, setPassword } from "../../lib/passwords.js";
import { txCtx } from "../../security/context.js";
import { checkOtp, createOtp, revokeAllSessions, type OtpRow } from "./service.js";

const email = z.email().max(200).transform((v) => v.trim().toLowerCase());

const GENERIC = {
  message: "Si el correo está registrado, recibirá un código para restablecer su contraseña.",
  otpTtlMinutes: config.OTP_TTL_MINUTES
};

export const forgotPassword = handler({ body: z.object({ email }) }, async ({ body, req }) => {
  const user = await one<{ id: string; email: string; recent: boolean }>(
    `SELECT u.id, u.email,
            EXISTS (SELECT 1 FROM users_otp o
                     WHERE o.user_id = u.id AND o.purpose = 'password_reset'
                       AND o.last_sent_at > NOW() - make_interval(secs => $2)) AS recent
       FROM users u WHERE u.email = $1 AND u.is_active`,
    [body.email, config.OTP_RESEND_SECONDS]
  );

  if (user && !user.recent) {
    const otp = await withTx(txCtx(req), (client) => createOtp(client, req, user.id, "password_reset"));
    await sendOtp(user.email, otp.code, "password_reset");
  }
  await logAuth(req, "password_forgot", Boolean(user), { userId: user?.id, email: body.email });
  return GENERIC;
});

const resetBody = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos"),
  newPassword: z.string().min(1).max(128)
});

const INVALID = new HttpError(400, "RESET_INVALID", "El código es incorrecto o venció. Solicite uno nuevo.");

export const resetPassword = handler({ body: resetBody }, async ({ body, req }) => {
  assertPasswordPolicy(body.newPassword, body.email);

  const result = await withTx(txCtx(req), async (client) => {
    const user = await one<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1 AND is_active`,
      [body.email],
      client
    );
    if (!user) return { fail: true as const };

    const otp = await one<OtpRow>(
      `SELECT id, user_id, code_hash, attempts, sends, last_sent_at, expires_at
         FROM users_otp
        WHERE user_id = $1 AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [user.id],
      client
    );
    if (!otp) return { fail: true as const, userId: user.id };

    const check = await checkOtp(client, otp, body.code);
    if (!check.ok) return { fail: true as const, userId: user.id };

    // Si la contraseña se repite, el throw revierte también el consumo del código: puede reintentar.
    await assertNotReused(client, user.id, user.password_hash, body.newPassword);
    await setPassword(client, user.id, user.password_hash, body.newPassword, false);
    await revokeAllSessions(client, user.id, "password_reset");
    return { fail: false as const, userId: user.id };
  });

  await logAuth(req, "password_reset", !result.fail, { userId: result.userId, email: body.email });
  if (result.fail) throw INVALID;
  return { message: "Contraseña actualizada. Ya puede iniciar sesión." };
});
