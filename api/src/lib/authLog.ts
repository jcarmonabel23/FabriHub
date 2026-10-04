/**
 * @project FabriHub - API
 * @file src/lib/authLog.ts
 * @description Registro de eventos en users_auth_history (nunca con secretos)
 */

import type { Request } from "express";
import { pool, type Db } from "../db.js";
import { clientInfo } from "../security/context.js";
import { logger } from "./logger.js";

export type AuthEvent =
  | "sign_in"
  | "otp_verify"
  | "otp_resend"
  | "refresh"
  | "refresh_reuse"
  | "logout"
  | "logout_all"
  | "locked"
  | "password_change"
  | "password_forgot"
  | "password_reset"
  | "admin_reset"
  | "admin_unlock"
  | "admin_revoke_sessions";

export async function logAuth(
  req: Request,
  event: AuthEvent,
  success: boolean,
  data: { userId?: string | null; email?: string | null; detail?: Record<string, unknown> } = {},
  db: Db = pool
): Promise<void> {
  const { ip, userAgent } = clientInfo(req);
  try {
    await db.query(
      `INSERT INTO users_auth_history (user_id, email, event_type, success, detail, trace_id, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [data.userId ?? null, data.email ?? null, event, success, data.detail ?? {}, req.traceId, ip, userAgent]
    );
  } catch (err) {
    logger.error({ err, event }, "[authLog] no se pudo registrar el evento");
  }
}
