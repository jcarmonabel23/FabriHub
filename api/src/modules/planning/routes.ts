/**
 * @project FabriHub - API
 * @file src/modules/planning/routes.ts
 * @description Rutas de Planificación (/api/v1/planning) — módulo PRD_PLANNING
 *
 * Convertir sugerencias exige además, en el servidor, poder crear OP (PRD_ORDERS) u OC (PUR_ORDERS).
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { convertSuggestions, dismissSuggestion, getRun, listRuns, runForPeriod, updateSuggestion } from "./mrp.js";
import { createPeriod, deletePeriod, generateMps, getPlans, listPeriods, removeProduct, salesFromHistory, savePlans, updatePeriod } from "./plans.js";

const M = "PRD_PLANNING";
export const planningRoutes = Router();

planningRoutes.get("/periods", can(M, "view"), listPeriods);
planningRoutes.post("/periods", can(M, "add_new"), createPeriod);
planningRoutes.patch("/periods/:id", can(M, "edit"), updatePeriod);
planningRoutes.delete("/periods/:id", can(M, "delete"), deletePeriod);

planningRoutes.get("/periods/:id/plans", can(M, "view"), getPlans);
planningRoutes.put("/periods/:id/plans", can(M, "edit"), savePlans);
planningRoutes.delete("/periods/:id/plans/:productId", can(M, "edit"), removeProduct);
planningRoutes.post("/periods/:id/sales-from-history", can(M, "edit"), salesFromHistory);
planningRoutes.post("/periods/:id/mps", can(M, "edit"), generateMps);

planningRoutes.post("/periods/:id/mrp", can(M, "add_new"), runForPeriod);
planningRoutes.get("/periods/:id/runs", can(M, "view"), listRuns);
planningRoutes.get("/runs/:id", can(M, "view"), getRun);

planningRoutes.patch("/suggestions/:id", can(M, "edit"), updateSuggestion);
planningRoutes.post("/suggestions/:id/dismiss", can(M, "edit"), dismissSuggestion);
planningRoutes.post("/suggestions/convert", can(M, "add_new"), convertSuggestions);
