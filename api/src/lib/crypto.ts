/**
 * @project FabriHub - API
 * @file src/lib/crypto.ts
 * @description Primitivas criptográficas: tokens aleatorios, hashes y códigos OTP
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
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

// ------------------------------------------------------------------ Secretos cifrados (AES-256-GCM)

function secretsKey(): Buffer {
  const raw = config.SECRETS_KEY;
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("SECRETS_KEY debe tener 32 bytes (base64 o hex)");
    return key;
  }
  return Buffer.from(hkdfSync("sha256", config.JWT_ACCESS_SECRET, "fabrihub", "company-secrets", 32));
}

/** Cifra un texto: «iv.tag.datos» en base64url (el iv es aleatorio en cada llamada) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** Descifra lo producido por encryptSecret; lanza si la clave cambió o el texto fue alterado */
export function decryptSecret(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", secretsKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
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
