/**
 * @project FabriHub - API
 * @file src/modules/production/routes.ts
 * @description Rutas de Producción (/api/v1/production). Etapas y tipos de centro van por /settings/catalogs
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import {
  createCenter,
  createFormula,
  createRoute,
  createWorkCenter,
  deleteCenter,
  deleteFormula,
  deleteRoute,
  deleteWorkCenter,
  explode,
  getFormula,
  getRoute,
  implode,
  listCenters,
  listFormulas,
  listRoutes,
  listWorkCenters,
  updateCenter,
  updateFormula,
  updateRoute,
  updateWorkCenter
} from "./masters.js";
import {
  availability,
  cancelOrder,
  closeOrder,
  confirmOrder,
  consumeMaterials,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  releaseOrder,
  setLineWarehouse,
  unreleaseOrder,
  updateOrder
} from "./orders.js";
import { finishProcess, listProcesses, startProcess } from "./tracking.js";

export const productionRoutes = Router();

// Centros de producción y de trabajo
productionRoutes.get("/centers", can("PRD_CENTERS", "view"), listCenters);
productionRoutes.post("/centers", can("PRD_CENTERS", "add_new"), createCenter);
productionRoutes.put("/centers/:id", can("PRD_CENTERS", "edit"), updateCenter);
productionRoutes.delete("/centers/:id", can("PRD_CENTERS", "delete"), deleteCenter);
productionRoutes.get("/work-centers", can("PRD_CENTERS", "view"), listWorkCenters);
productionRoutes.post("/work-centers", can("PRD_CENTERS", "add_new"), createWorkCenter);
productionRoutes.put("/work-centers/:id", can("PRD_CENTERS", "edit"), updateWorkCenter);
productionRoutes.delete("/work-centers/:id", can("PRD_CENTERS", "delete"), deleteWorkCenter);

// Rutas
productionRoutes.get("/routes", can("PRD_ROUTES", "view"), listRoutes);
productionRoutes.get("/routes/:id", can("PRD_ROUTES", "view"), getRoute);
productionRoutes.post("/routes", can("PRD_ROUTES", "add_new"), createRoute);
productionRoutes.put("/routes/:id", can("PRD_ROUTES", "edit"), updateRoute);
productionRoutes.delete("/routes/:id", can("PRD_ROUTES", "delete"), deleteRoute);

// Fórmulas, explosión e implosión
productionRoutes.get("/formulas", can("PRD_FORMULAS", "view"), listFormulas);
productionRoutes.get("/formulas/explode", can("PRD_FORMULAS", "view"), explode);
productionRoutes.get("/formulas/implode", can("PRD_FORMULAS", "view"), implode);
productionRoutes.get("/formulas/:id", can("PRD_FORMULAS", "view"), getFormula);
productionRoutes.post("/formulas", can("PRD_FORMULAS", "add_new"), createFormula);
productionRoutes.put("/formulas/:id", can("PRD_FORMULAS", "edit"), updateFormula);
productionRoutes.delete("/formulas/:id", can("PRD_FORMULAS", "delete"), deleteFormula);

// Órdenes de producción
productionRoutes.get("/orders", can("PRD_ORDERS", "view"), listOrders);
productionRoutes.get("/orders/:id", can("PRD_ORDERS", "view"), getOrder);
productionRoutes.get("/orders/:id/availability", can("PRD_ORDERS", "view"), availability);
productionRoutes.post("/orders", can("PRD_ORDERS", "add_new"), createOrder);
productionRoutes.put("/orders/:id", can("PRD_ORDERS", "edit"), updateOrder);
productionRoutes.put("/orders/:id/lines/:lineId/warehouse", can("PRD_ORDERS", "edit"), setLineWarehouse);
productionRoutes.delete("/orders/:id", can("PRD_ORDERS", "delete"), deleteOrder);
productionRoutes.post("/orders/:id/release", can("PRD_ORDERS", "release"), releaseOrder);
productionRoutes.post("/orders/:id/unrelease", can("PRD_ORDERS", "release"), unreleaseOrder);
productionRoutes.post("/orders/:id/consume", can("PRD_ORDERS", "edit"), consumeMaterials);
productionRoutes.post("/orders/:id/confirm", can("PRD_ORDERS", "edit"), confirmOrder);
productionRoutes.post("/orders/:id/close", can("PRD_ORDERS", "close"), closeOrder);
productionRoutes.post("/orders/:id/cancel", can("PRD_ORDERS", "delete"), cancelOrder);

// Seguimiento por etapa
productionRoutes.get("/tracking", can("PRD_TRACKING", "view"), listProcesses);
productionRoutes.post("/tracking/:id/start", can("PRD_TRACKING", "edit"), startProcess);
productionRoutes.post("/tracking/:id/finish", can("PRD_TRACKING", "edit"), finishProcess);
