/**
 * @project FabriHub - API
 * @file src/modules/metrics/routes.ts
 * @description POST /metrics/visit — registra la visita del usuario a un módulo
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../../db.js";
import { handler } from "../../lib/http.js";
import { authOf } from "../../security/context.js";

const body = z.object({
  moduleCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  path: z.string().max(200).optional()
});

const visit = handler({ body }, async ({ body, req }) => {
  await query(
    `INSERT INTO metrics_module_usage (user_id, module_code, path)
     SELECT $1, $2::text, $3 WHERE EXISTS (SELECT 1 FROM catalogs_modules WHERE code = $2::text)`,
    [authOf(req).userId, body.moduleCode, body.path ?? null]
  );
  return undefined;
});

export const metricsRoutes = Router();
metricsRoutes.post("/visit", visit);
