/**
 * @project FabriHub - API
 * @file src/modules/einvoice/routes.ts
 * @description Rutas de comprobantes electrónicos de Costa Rica (/api/v1/einvoice)
 *
 * Permisos:
 *  - SET_COMPANY: view = ver la configuración; edit = configurar, cargar credenciales y llave, procesar la cola.
 *  - POS_SALES:   view = consultar comprobantes y descargar su XML; approve = reintentar el envío de uno.
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import {
  deleteEinvoiceCertificate,
  deleteEinvoiceCredentials,
  getEinvoiceDocument,
  getEinvoiceSettings,
  getEinvoiceXml,
  listEinvoiceDocuments,
  processEinvoiceQueue,
  retryEinvoiceDocument,
  saveEinvoiceCertificate,
  saveEinvoiceCredentials,
  saveEinvoiceSettings
} from "./service.js";

export const einvoiceRoutes = Router();

einvoiceRoutes.get("/settings", can("SET_COMPANY", "view"), getEinvoiceSettings);
einvoiceRoutes.put("/settings", can("SET_COMPANY", "edit"), saveEinvoiceSettings);
einvoiceRoutes.put("/credentials", can("SET_COMPANY", "edit"), saveEinvoiceCredentials);
einvoiceRoutes.delete("/credentials", can("SET_COMPANY", "edit"), deleteEinvoiceCredentials);
einvoiceRoutes.put("/certificate", can("SET_COMPANY", "edit"), saveEinvoiceCertificate);
einvoiceRoutes.delete("/certificate", can("SET_COMPANY", "edit"), deleteEinvoiceCertificate);
einvoiceRoutes.post("/process", can("SET_COMPANY", "edit"), processEinvoiceQueue);

einvoiceRoutes.get("/documents", can("POS_SALES", "view"), listEinvoiceDocuments);
einvoiceRoutes.get("/documents/:id", can("POS_SALES", "view"), getEinvoiceDocument);
einvoiceRoutes.get("/documents/:id/xml", can("POS_SALES", "view"), getEinvoiceXml);
einvoiceRoutes.post("/documents/:id/retry", can("POS_SALES", "approve"), retryEinvoiceDocument);
