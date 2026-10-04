/**
 * @project FabriHub - API
 * @file src/modules/settings/routes.ts
 * @description Rutas de Parámetros del Sistema (/api/v1/settings)
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import {
  catalogsMeta,
  createCatalogItem,
  deleteCatalogItem,
  deleteRate,
  listCatalog,
  listRates,
  updateCatalogItem,
  upsertRate
} from "./catalogs.js";
import { catalogCan } from "./catalogCan.js";
import { getCompany, updateCompany } from "./company.js";
import { listParameters, listSequences, resetParameter, updateParameter, updateSequence } from "./parameters.js";

export const settingsRoutes = Router();

// Empresa
settingsRoutes.get("/company", can("SET_COMPANY", "view"), getCompany);
settingsRoutes.put("/company", can("SET_COMPANY", "edit"), updateCompany);

// Parámetros y correlativos
settingsRoutes.get("/parameters", can("SET_PARAMETERS", "view"), listParameters);
settingsRoutes.patch("/parameters/:id", can("SET_PARAMETERS", "configure"), updateParameter);
settingsRoutes.post("/parameters/:id/reset", can("SET_PARAMETERS", "configure"), resetParameter);
settingsRoutes.get("/sequences", can("SET_PARAMETERS", "view"), listSequences);
settingsRoutes.patch("/sequences/:docType", can("SET_PARAMETERS", "configure"), updateSequence);

// Catálogos simples (motor genérico): el permiso se exige sobre el módulo DECLARADO de cada catálogo
settingsRoutes.get("/catalogs", catalogsMeta);
settingsRoutes.get("/catalogs/:key", catalogCan("view"), listCatalog);
settingsRoutes.post("/catalogs/:key", catalogCan("add_new"), createCatalogItem);
settingsRoutes.patch("/catalogs/:key/:id", catalogCan("edit"), updateCatalogItem);
settingsRoutes.delete("/catalogs/:key/:id", catalogCan("delete"), deleteCatalogItem);

// Tasas de cambio
settingsRoutes.get("/currencies/:id/rates", can("SET_COMMERCIAL", "view"), listRates);
settingsRoutes.post("/currencies/:id/rates", can("SET_COMMERCIAL", "edit"), upsertRate);
settingsRoutes.delete("/currencies/rates/:rateId", can("SET_COMMERCIAL", "delete"), deleteRate);
