/**
 * @project FabriHub - API
 * @file src/security/rateLimits.ts
 * @description Límites de frecuencia por IP (complementan el bloqueo por cuenta)
 */

import { rateLimit } from "express-rate-limit";

const tooMany = { error: { code: "RATE_LIMITED", message: "Demasiados intentos. Espere unos minutos." } };

/**
 * Login, OTP y recuperación: AUTH_RATE_LIMIT intentos cada 15 minutos por IP (por defecto 60 = 4 por minuto).
 * Complementa al bloqueo por cuenta: este frena el rociado de contraseñas contra MUCHAS cuentas.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT ?? 60),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: tooMany
});

/** Refresh: el front lo llama solo; un tope holgado contra abuso */
export const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: tooMany
});

/** Resto de la API autenticada */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: tooMany
});
