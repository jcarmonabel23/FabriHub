/**
 * @project FabriHub - API
 * @file src/modules/auth/otpResend.ts
 * @description POST /auth/otp/resend — nuevo código para el mismo desafío (con espera y tope)
 */

import { z } from "zod";
import { config } from "../../config.js";
import { one, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { hmac, otpCode } from "../../lib/crypto.js";
import { HttpError, handler } from "../../lib/http.js";
import { sendOtp } from "../../lib/mailer.js";
import { txCtx } from "../../security/context.js";

const body = z.object({ challengeId: z.uuid() });

export const otpResend = handler({ body }, async ({ body, req }) => {
  const sent = await withTx(txCtx(req), async (client) => {
    const otp = await one<{ id: string; sends: number; wait: number; email: string; user_id: string }>(
      `SELECT o.id, o.sends, o.user_id, u.email,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (o.last_sent_at + make_interval(secs => $2) - NOW()))))::int AS wait
         FROM users_otp o JOIN users u ON u.id = o.user_id
        WHERE o.id = $1 AND o.purpose = 'login' AND o.consumed_at IS NULL AND u.is_active
        FOR UPDATE OF o`,
      [body.challengeId, config.OTP_RESEND_SECONDS],
      client
    );
    if (!otp) throw new HttpError(401, "OTP_EXPIRED", "El desafío ya no es válido. Inicie sesión de nuevo.");
    if (otp.sends >= config.OTP_MAX_SENDS) {
      throw new HttpError(429, "OTP_MAX_SENDS", "Alcanzó el máximo de reenvíos. Inicie sesión de nuevo.");
    }
    if (otp.wait > 0) throw new HttpError(429, "OTP_COOLDOWN", `Espere ${otp.wait} s para pedir otro código.`);

    const code = otpCode();
    const expiresAt = new Date(Date.now() + config.OTP_TTL_MINUTES * 60 * 1000);
    await client.query(
      `UPDATE users_otp SET code_hash = $2, attempts = 0, sends = sends + 1, last_sent_at = NOW(), expires_at = $3
        WHERE id = $1`,
      [otp.id, hmac(code), expiresAt]
    );
    await logAuth(req, "otp_resend", true, { userId: otp.user_id, email: otp.email }, client);
    return { email: otp.email, code, expiresAt };
  });

  await sendOtp(sent.email, sent.code, "login");
  return { otpExpiresAt: sent.expiresAt.toISOString(), resendAfterSeconds: config.OTP_RESEND_SECONDS };
});
