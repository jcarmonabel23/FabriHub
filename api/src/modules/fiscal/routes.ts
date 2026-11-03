/**
 * @project FabriHub - API
 * @file src/modules/fiscal/routes.ts
 * @description Rutas del documento fiscal de Venezuela (/api/v1/fiscal)
 *
 * Permisos:
 *  - SET_COMPANY:  view = ver la configuración; edit = configurar la imprenta digital y su clave de API.
 *  - POS_SALES:    view = consultar documentos y su PDF; add_new = la caja imprime en su impresora fiscal
 *                  (documento para el agente, resultado, falla y contingencia); approve = reintentar o procesar
 *                  la cola de la imprenta digital.
 *  - POS_SESSIONS: close = registrar el reporte Z de la impresora; view = consultarlos.
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import {
  deleteFiscalApiKey,
  getFiscalDocument,
  getFiscalPayload,
  getFiscalPdf,
  getFiscalSettings,
  listFiscalDocuments,
  listZReports,
  markFiscalContingency,
  markFiscalFailed,
  markFiscalPrinted,
  processFiscalQueue,
  retryFiscalDocument,
  saveFiscalApiKey,
  saveFiscalSettings,
  saveZReport,
  terminalPendingDocs,
  testFiscalDigital
} from "./service.js";

export const fiscalRoutes = Router();

fiscalRoutes.get("/settings", can("SET_COMPANY", "view"), getFiscalSettings);
fiscalRoutes.put("/settings", can("SET_COMPANY", "edit"), saveFiscalSettings);
fiscalRoutes.put("/api-key", can("SET_COMPANY", "edit"), saveFiscalApiKey);
fiscalRoutes.delete("/api-key", can("SET_COMPANY", "edit"), deleteFiscalApiKey);
fiscalRoutes.post("/digital/test", can("SET_COMPANY", "edit"), testFiscalDigital);
fiscalRoutes.post("/process", can("POS_SALES", "approve"), processFiscalQueue);

fiscalRoutes.get("/documents", can("POS_SALES", "view"), listFiscalDocuments);
fiscalRoutes.get("/documents/:id", can("POS_SALES", "view"), getFiscalDocument);
fiscalRoutes.get("/documents/:id/pdf", can("POS_SALES", "view"), getFiscalPdf);
fiscalRoutes.get("/documents/:id/payload", can("POS_SALES", "add_new"), getFiscalPayload);
fiscalRoutes.post("/documents/:id/printed", can("POS_SALES", "add_new"), markFiscalPrinted);
fiscalRoutes.post("/documents/:id/failed", can("POS_SALES", "add_new"), markFiscalFailed);
fiscalRoutes.post("/documents/:id/contingency", can("POS_SALES", "add_new"), markFiscalContingency);
fiscalRoutes.post("/documents/:id/retry", can("POS_SALES", "approve"), retryFiscalDocument);
fiscalRoutes.get("/terminals/:id/pending", can("POS_SALES", "add_new"), terminalPendingDocs);

fiscalRoutes.get("/z-reports", can("POS_SESSIONS", "view"), listZReports);
fiscalRoutes.post("/z-reports", can("POS_SESSIONS", "close"), saveZReport);
