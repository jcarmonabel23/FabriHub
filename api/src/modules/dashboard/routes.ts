/**
 * @project FabriHub - API
 * @file src/modules/dashboard/routes.ts
 * @description Rutas del Tablero (/api/v1/dashboard): Indicadores, Alertas y Reportes
 *
 * Cada pantalla tiene su permiso; además, lo que se muestra dentro se filtra por el permiso `view`
 * del módulo de origen (inventario, compras, ventas…) con su alcance de datos.
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { alertsSummary, listAlerts, listRuns, runNow } from "./alerts.js";
import { getIndicators } from "./indicators.js";
import { downloadReport, listReports, previewReport } from "./reports.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/indicators", can("DSH_INDICATORS", "view"), getIndicators);

dashboardRoutes.get("/alerts", can("DSH_ALERTS", "view"), listAlerts);
dashboardRoutes.get("/alerts/summary", can("DSH_ALERTS", "view"), alertsSummary);
dashboardRoutes.get("/alerts/runs", can("DSH_ALERTS", "view"), listRuns);
dashboardRoutes.post("/alerts/run", can("DSH_ALERTS", "configure"), runNow);

dashboardRoutes.get("/reports", can("DSH_REPORTS", "download"), listReports);
dashboardRoutes.get("/reports/:code/preview", can("DSH_REPORTS", "download"), previewReport);
dashboardRoutes.get("/reports/:code/xlsx", can("DSH_REPORTS", "download"), downloadReport);
