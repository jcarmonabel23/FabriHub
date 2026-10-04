/**
 * @project FabriHub - API
 * @file src/security/tokens.ts
 * @description Access JWT (corto, firmado HS256) y cookie del refresh token (httpOnly)
 */

import jwt, { type SignOptions } from "jsonwebtoken";
import type { Response } from "express";
import { config } from "../config.js";

const ISSUER = "fabrihub-api";
const AUDIENCE = "fabrihub-front";

export const REFRESH_COOKIE = "fh_refresh";
/** La cookie solo viaja a los endpoints de auth: el resto de la API nunca la ve */
const REFRESH_COOKIE_PATH = "/api/v1/auth";

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(userId: string, sessionId: string): { token: string; expiresAt: number } {
  const token = jwt.sign({ sid: sessionId }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
    expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"]
  });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: exp };
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"]
    }) as jwt.JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH
  });
}
