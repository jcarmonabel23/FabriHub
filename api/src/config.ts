/**
 * @project FabriHub - API
 * @file src/config.ts
 * @description Configuración tipada desde variables de entorno (falla al arrancar si falta algo)
 */

import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().default(4000),
  APP_ENVIRONMENT: z.enum(["dev", "qa", "prod"]).default("dev"),

  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET debe tener al menos 32 caracteres"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_HOURS: z.coerce.number().positive().default(8),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),

  OTP_TTL_MINUTES: z.coerce.number().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_MAX_SENDS: z.coerce.number().int().positive().default(3),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(30),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  PASSWORD_HISTORY: z.coerce.number().int().min(1).default(5),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  COOKIE_SECURE: bool,

  SMTP_HOST: z.string().default("mailpit"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default("FabriHub <no-reply@fabrihub.local>"),
  /** Proveedor real (producción): usuario/clave SMTP. Vacíos = sin autenticación (mailpit) */
  SMTP_USER: z.string().optional().transform((v) => v || undefined),
  SMTP_PASSWORD: z.string().optional().transform((v) => v || undefined),
  /** true = TLS directo (puerto 465); false = STARTTLS si el servidor lo ofrece (587) */
  SMTP_SECURE: bool,
  /** URL con la que los usuarios abren FabriHub (enlaces de los correos de alertas) */
  APP_PUBLIC_URL: z.url().default("http://localhost:8080").transform((v) => v.replace(/\/$/, "")),

  ADMIN_EMAIL: z.email(),
  ADMIN_INITIAL_PASSWORD: z.string().min(10)
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("[config] Variables de entorno inválidas:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;

export const isProduction = config.NODE_ENV === "production";
