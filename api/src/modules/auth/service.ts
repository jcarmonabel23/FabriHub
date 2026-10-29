/**
 * @project FabriHub - API
 * @file src/modules/auth/service.ts
 * @description Lógica compartida de autenticación: sesiones, OTP y respuesta de sesión
 */

import type { Request, Response } from "express";
import type pg from "pg";
import { config } from "../../config.js";
import { one, query, runInCompany, type Db } from "../../db.js";
import { hmac, otpCode, randomToken, safeEqualHex, sha256 } from "../../lib/crypto.js";
import { sessionModules, type SessionModule } from "../../security/authorize.js";
import { clientInfo } from "../../security/context.js";
import { setRefreshCookie, signAccessToken } from "../../security/tokens.js";
import { brandingUrls } from "../settings/branding.js";

export interface UserRow {
  id: string;
  email: string;
  names: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

export const USER_COLUMNS =
  "id, email, names, password_hash, is_active, must_change_password, failed_attempts, locked_until";

export interface SessionUser {
  id: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
  /** Lo calcula sessionPayload */
  isPlatformAdmin?: boolean;
}

/** Empresa activa de la sesión, con su identidad (URLs firmadas: se renuevan con cada refresh) */
export interface SessionCompany {
  id: string;
  code: string;
  name: string;
  brandColor: string | null;
  logo: { header: string; doc: string } | null;
  icon: { favicon: string; app: string } | null;
}

export interface SessionPayload {
  user: SessionUser;
  company: SessionCompany | null;
  modules: SessionModule[];
  environment: string;
  idleMinutes: number;
}

export interface TokenPayload extends SessionPayload {
  accessToken: string;
  accessExpiresAt: number;
}

/** Correo enmascarado para la pantalla OTP: j*****a@dominio.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`;
}

export async function sessionPayload(user: SessionUser, companyId: string | null): Promise<SessionPayload> {
  const flags = await one<{ is_platform_admin: boolean }>(`SELECT is_platform_admin FROM users WHERE id = $1`, [user.id]);
  const row = companyId
    ? await one<{ id: string; code: string; name: string; logo_file_id: string | null; icon_file_id: string | null; brand_color: string | null }>(
        `SELECT id, code, COALESCE(trade_name, legal_name) AS name, logo_file_id, icon_file_id, brand_color
           FROM companies WHERE id = $1`,
        [companyId]
      )
    : null;
  const company: SessionCompany | null = row ? { id: row.id, code: row.code, name: row.name, ...brandingUrls(row) } : null;
  return {
    user: { ...user, isPlatformAdmin: flags?.is_platform_admin ?? false },
    company,
    // Los permisos son por empresa: se leen con la empresa de la sesión activa
    modules: company ? await runInCompany(company.id, () => sessionModules(user.id)) : [],
    environment: config.APP_ENVIRONMENT,
    idleMinutes: config.SESSION_IDLE_MINUTES
  };
}

/**
 * @function openSession
 * @description Crea la sesión, entrega el refresh en cookie httpOnly y devuelve el access token.
 * La sesión arranca en la empresa por defecto del usuario (o la primera activa que tenga).
 */
export async function openSession(db: Db, req: Request, res: Response, user: SessionUser): Promise<TokenPayload> {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_HOURS * 3600 * 1000);
  const { ip, userAgent } = clientInfo(req);

  const [session] = await query<{ id: string; company_id: string | null }>(
    `INSERT INTO users_sessions (user_id, refresh_hash, ip_address, user_agent, expires_at, company_id)
     VALUES ($1, $2, $3, $4, $5,
             (SELECT uc.company_id FROM users_companies uc JOIN companies c ON c.id = uc.company_id AND c.is_active
               WHERE uc.user_id = $1 AND uc.is_active
               ORDER BY uc.is_default DESC, uc.created_at LIMIT 1))
     RETURNING id, company_id`,
    [user.id, sha256(refreshToken), ip, userAgent, expiresAt],
    db
  );

  setRefreshCookie(res, refreshToken, expiresAt);
  const access = signAccessToken(user.id, session.id);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    ...(await sessionPayload(user, session.company_id))
  };
}

export async function revokeAllSessions(db: Db, userId: string, reason: string, exceptSessionId?: string) {
  await query(
    `UPDATE users_sessions SET revoked_at = NOW(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [userId, reason, exceptSessionId ?? null],
    db
  );
}

// ------------------------------------------------------------------ OTP

export type OtpPurpose = "login" | "password_reset";

/**
 * @function createOtp
 * @description Invalida los desafíos pendientes del mismo propósito y crea uno nuevo
 */
export async function createOtp(
  db: Db,
  req: Request,
  userId: string,
  purpose: OtpPurpose
): Promise<{ challengeId: string; code: string; expiresAt: Date }> {
  await query(
    `UPDATE users_otp SET consumed_at = NOW()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
    db
  );
  const code = otpCode();
  const expiresAt = new Date(Date.now() + config.OTP_TTL_MINUTES * 60 * 1000);
  const [row] = await query<{ id: string }>(
    `INSERT INTO users_otp (user_id, purpose, code_hash, expires_at, ip_address)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, purpose, hmac(code), expiresAt, clientInfo(req).ip],
    db
  );
  return { challengeId: row.id, code, expiresAt };
}

export interface OtpRow {
  id: string;
  user_id: string;
  code_hash: string;
  attempts: number;
  sends: number;
  last_sent_at: Date;
  expires_at: Date;
}

export type OtpCheck = { ok: true } | { ok: false; reason: "invalid" | "locked"; remaining: number };

/**
 * @function checkOtp
 * @description Compara el código. Si falla suma un intento; al llegar al tope invalida el desafío.
 * Debe llamarse dentro de una transacción con la fila bloqueada (FOR UPDATE).
 */
export async function checkOtp(client: pg.PoolClient, otp: OtpRow, code: string): Promise<OtpCheck> {
  if (safeEqualHex(otp.code_hash, hmac(code))) {
    await client.query(`UPDATE users_otp SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
    return { ok: true };
  }
  const attempts = otp.attempts + 1;
  const locked = attempts >= config.OTP_MAX_ATTEMPTS;
  await client.query(
    `UPDATE users_otp SET attempts = $2, consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END WHERE id = $1`,
    [otp.id, attempts, locked]
  );
  return { ok: false, reason: locked ? "locked" : "invalid", remaining: Math.max(0, config.OTP_MAX_ATTEMPTS - attempts) };
}
