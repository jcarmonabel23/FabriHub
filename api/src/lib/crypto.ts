/**
 * @project FabriHub - API
 * @file src/lib/crypto.ts
 * @description Primitivas criptográficas: tokens aleatorios, hashes y códigos OTP
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Token opaco de alta entropía (refresh token): 48 bytes en base64url */
export const randomToken = (): string => randomBytes(48).toString("base64url");

/** SHA-256 hex. Suficiente para tokens de alta entropía (no para contraseñas) */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * HMAC-SHA256 con la clave del servidor. Para códigos OTP de 6 dígitos: con un hash
 * simple, quien leyera la tabla podría probar el millón de combinaciones sin conocer la clave.
 */
export const hmac = (value: string): string =>
  createHmac("sha256", config.JWT_ACCESS_SECRET).update(value).digest("hex");

/** Comparación en tiempo constante de dos hex del mismo largo */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Código OTP de 6 dígitos con CSPRNG */
export const otpCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

/** Contraseña temporal que cumple la política (para altas y reinicios por admin) */
export function temporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_.";
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[randomInt(0, set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
