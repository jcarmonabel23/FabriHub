/**
 * @project FabriHub - API
 * @file src/modules/settings/catalogCan.ts
 * @description Autorización de las rutas genéricas de catálogos: el módulo sale de la declaración
 *
 * `/settings/catalogs/zones` se autoriza contra SET_COMMERCIAL y `/settings/catalogs/units` contra
 * INV_CATALOGS: quien administra catálogos comerciales no toca los de inventario y viceversa.
 */

import type { NextFunction, Request, Response } from "express";
import { badRequest } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { CATALOGS } from "./catalogEngine.js";

export const catalogCan =
  (slug: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const def = CATALOGS[String(req.params.key)];
    if (!def) {
      next(badRequest("UNKNOWN_CATALOG", "Catálogo inexistente"));
      return;
    }
    void requirePermission(def.module, slug)(req, res, next);
  };
