/**
 * @project FabriHub - API
 * @file src/lib/logger.ts
 * @description Logger estructurado (JSON). Nunca registrar contraseñas, tokens ni códigos OTP.
 */

import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "fabrihub-api" },
  redact: {
    paths: ["*.password", "*.newPassword", "*.currentPassword", "*.token", "*.authorization", "*.cookie"],
    censor: "[oculto]"
  }
});
