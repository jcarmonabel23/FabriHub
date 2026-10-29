/**
 * @project FabriHub - API
 * @file src/modules/settings/catalogCan.ts
 * @description Autorización de las rutas genéricas de catálogos: el módulo sale de la declaración
 *
 * `/settings/catalogs/zones` se autoriza contra SET_COMMERCIAL y `/settings/catalogs/units` contra
 * INV_CATALOGS: quien administra catálogos comerciales no toca los de inventario y viceversa.
 * Los catálogos globales (compartidos por todas las empresas) solo los modifica un administrador
 * de plataforma: cualquier permiso distinto de `view` exige serlo.
 */

import type { NextFunction, Request, Response } from "express";
import { badRequest, forbidden } from "../../lib/http.js";
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
    if (def.global && slug !== "view" && !req.auth?.isPlatformAdmin) {
      next(forbidden("PLATFORM_ONLY", "Este catálogo es común a todas las empresas: solo lo modifica el administrador de la plataforma"));
      return;
    }
    void requirePermission(def.module, slug)(req, res, next);
  };
