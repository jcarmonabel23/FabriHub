/**
 * @project FabriHub - API
 * @file src/index.ts
 * @description Punto de entrada de los servicios empresariales
 *
 * @overview
 * Orden de middlewares (importa):
 *   trace → helmet → json(limitado) → cookies → rutas públicas de auth →
 *   [authenticate → rate limit] → rutas de negocio → 404 → manejador de errores
 */

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { bootstrap } from "./bootstrap.js";
import { config, isProduction } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { lookupsRoutes } from "./modules/lookups/routes.js";
import { metricsRoutes } from "./modules/metrics/routes.js";
import { purchasesRoutes, qualityRoutes } from "./modules/purchases/routes.js";
import { productionRoutes } from "./modules/production/routes.js";
import { salesRoutes } from "./modules/sales/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { taxesRoutes } from "./modules/taxes/routes.js";
import { authenticate } from "./security/authenticate.js";
import { apiLimiter } from "./security/rateLimits.js";
import { trace } from "./security/trace.js";

const app = express();

/** Códigos SQLSTATE de PostgreSQL que son errores del usuario, no del sistema */
const PG_ERRORS: Record<string, [number, string, string]> = {
  "23505": [409, "DUPLICATED", "Ya existe un registro con ese código"],
  "23503": [409, "IN_USE", "El registro está en uso por otros datos; desactívelo en lugar de eliminarlo"],
  "23514": [400, "CHECK_VIOLATION", "Algún valor no cumple las reglas del registro"],
  P0001: [400, "BUSINESS_RULE", "La operación viola una regla de negocio"]
};

app.disable("x-powered-by");
// Una capa de proxy delante (el Express del front). req.ip = IP real del cliente.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

app.use(trace);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});

const v1 = express.Router();
v1.use("/auth", authRoutes);
v1.use(authenticate(), apiLimiter);
v1.use("/admin", adminRoutes);
v1.use("/metrics", metricsRoutes);
v1.use("/lookups", lookupsRoutes);
v1.use("/settings", settingsRoutes);
v1.use("/taxes", taxesRoutes);
v1.use("/inventory", inventoryRoutes);
v1.use("/purchases", purchasesRoutes);
v1.use("/quality", qualityRoutes);
v1.use("/production", productionRoutes);
v1.use("/sales", salesRoutes);
app.use("/api/v1", v1);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso no encontrado" } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.locals.errorCode = "VALIDATION";
    res.status(400).json({
      error: {
        code: "VALIDATION",
        message: "Datos inválidos",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      }
    });
    return;
  }
  if (err instanceof HttpError) {
    res.locals.errorCode = err.code;
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Restricciones de la BD → mensajes de negocio (la BD es la última línea de defensa).
  const pgCode = (err as { code?: unknown })?.code;
  if (typeof pgCode === "string" && PG_ERRORS[pgCode]) {
    const [status, code, generic] = PG_ERRORS[pgCode];
    // P0001 = RAISE EXCEPTION de nuestras funciones: su texto ya es un mensaje de negocio.
    const message = pgCode === "P0001" ? (err as Error).message : generic;
    res.locals.errorCode = code;
    res.status(status).json({ error: { code, message, details: (err as { constraint?: string }).constraint } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.locals.errorCode = "BAD_JSON";
    res.status(400).json({ error: { code: "BAD_JSON", message: "JSON mal formado" } });
    return;
  }
  res.locals.errorCode = "INTERNAL";
  logger.error({ err, traceId: req.traceId, path: req.path }, "[api] error no controlado");
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: `Error interno. Referencia: ${req.traceId}`,
      ...(isProduction ? {} : { debug: String(err) })
    }
  });
});

bootstrap()
  .then(() => {
    app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.APP_ENVIRONMENT }, "[api] lista"));
  })
  .catch((err) => {
    logger.fatal({ err }, "[api] no se pudo arrancar");
    process.exit(1);
  });
