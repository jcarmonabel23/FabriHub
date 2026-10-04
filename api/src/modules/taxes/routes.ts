/**
 * @project FabriHub - API
 * @file src/modules/taxes/routes.ts
 * @description Rutas de Impuestos (/api/v1/taxes)
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { createTax, createTaxRate, deleteTax, deleteTaxRate, listTaxes, updateTax, updateTaxRate } from "./taxes.js";
import {
  createTreatment,
  deleteTreatment,
  listTreatments,
  simulateTreatment,
  treatmentOptions,
  updateTreatment
} from "./treatments.js";
import {
  createWithholding,
  createWithholdingRate,
  deleteWithholding,
  deleteWithholdingRate,
  listWithholdings,
  updateWithholding,
  updateWithholdingRate
} from "./withholdings.js";

export const taxesRoutes = Router();

// Impuestos
taxesRoutes.get("/taxes", can("TAX_TAXES", "view"), listTaxes);
taxesRoutes.post("/taxes", can("TAX_TAXES", "add_new"), createTax);
taxesRoutes.patch("/taxes/:id", can("TAX_TAXES", "edit"), updateTax);
taxesRoutes.delete("/taxes/:id", can("TAX_TAXES", "delete"), deleteTax);
taxesRoutes.post("/taxes/:id/rates", can("TAX_TAXES", "add_new"), createTaxRate);
taxesRoutes.patch("/tax-rates/:rateId", can("TAX_TAXES", "edit"), updateTaxRate);
taxesRoutes.delete("/tax-rates/:rateId", can("TAX_TAXES", "delete"), deleteTaxRate);

// Retenciones
taxesRoutes.get("/withholdings", can("TAX_WITHHOLDINGS", "view"), listWithholdings);
taxesRoutes.post("/withholdings", can("TAX_WITHHOLDINGS", "add_new"), createWithholding);
taxesRoutes.patch("/withholdings/:id", can("TAX_WITHHOLDINGS", "edit"), updateWithholding);
taxesRoutes.delete("/withholdings/:id", can("TAX_WITHHOLDINGS", "delete"), deleteWithholding);
taxesRoutes.post("/withholdings/:id/rates", can("TAX_WITHHOLDINGS", "add_new"), createWithholdingRate);
taxesRoutes.patch("/withholding-rates/:rateId", can("TAX_WITHHOLDINGS", "edit"), updateWithholdingRate);
taxesRoutes.delete("/withholding-rates/:rateId", can("TAX_WITHHOLDINGS", "delete"), deleteWithholdingRate);

// Tratamientos fiscales
taxesRoutes.get("/treatments", can("TAX_TREATMENTS", "view"), listTreatments);
taxesRoutes.get("/treatments/options", can("TAX_TREATMENTS", "view"), treatmentOptions);
taxesRoutes.post("/treatments", can("TAX_TREATMENTS", "add_new"), createTreatment);
taxesRoutes.patch("/treatments/:id", can("TAX_TREATMENTS", "edit"), updateTreatment);
taxesRoutes.delete("/treatments/:id", can("TAX_TREATMENTS", "delete"), deleteTreatment);
taxesRoutes.post("/treatments/:id/simulate", can("TAX_TREATMENTS", "view"), simulateTreatment);
