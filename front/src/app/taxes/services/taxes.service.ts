/**
 * @project FabriHub - Front
 * @file src/app/taxes/services/taxes.service.ts
 * @description Llamadas a /taxes/*
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "@clients/apiClient";
import type { Bracket, Simulation, Tax, Treatment, Withholding } from "../types";

type Body = Record<string, unknown>;

export const taxesApi = {
  listTaxes: () => apiGet<Tax[]>("/taxes/taxes"),
  createTax: (b: Body) => apiPost<Tax>("/taxes/taxes", b),
  updateTax: (id: string, b: Body) => apiPatch<Tax>(`/taxes/taxes/${id}`, b),
  deleteTax: (id: string) => apiDelete<void>(`/taxes/taxes/${id}`),
  createTaxRate: (taxId: string, b: Body) => apiPost<Tax>(`/taxes/taxes/${taxId}/rates`, b),
  updateTaxRate: (rateId: string, b: Body) => apiPatch<Tax>(`/taxes/tax-rates/${rateId}`, b),
  deleteTaxRate: (rateId: string) => apiDelete<void>(`/taxes/tax-rates/${rateId}`),

  listWithholdings: () => apiGet<Withholding[]>("/taxes/withholdings"),
  createWithholding: (b: Body) => apiPost<Withholding>("/taxes/withholdings", b),
  updateWithholding: (id: string, b: Body) => apiPatch<Withholding>(`/taxes/withholdings/${id}`, b),
  deleteWithholding: (id: string) => apiDelete<void>(`/taxes/withholdings/${id}`),
  createWithholdingRate: (whId: string, b: Body & { brackets: Bracket[] }) => apiPost<Withholding>(`/taxes/withholdings/${whId}/rates`, b),
  updateWithholdingRate: (rateId: string, b: Body) => apiPatch<Withholding>(`/taxes/withholding-rates/${rateId}`, b),
  deleteWithholdingRate: (rateId: string) => apiDelete<void>(`/taxes/withholding-rates/${rateId}`),

  listTreatments: () => apiGet<Treatment[]>("/taxes/treatments"),
  treatmentOptions: () =>
    apiGet<{ taxRates: { value: string; label: string }[]; withholdingRates: { value: string; label: string }[] }>(
      "/taxes/treatments/options"
    ),
  createTreatment: (b: Body) => apiPost<Treatment>("/taxes/treatments", b),
  updateTreatment: (id: string, b: Body) => apiPatch<Treatment>(`/taxes/treatments/${id}`, b),
  deleteTreatment: (id: string) => apiDelete<void>(`/taxes/treatments/${id}`),
  simulate: (id: string, amount: number, date?: string) => apiPost<Simulation>(`/taxes/treatments/${id}/simulate`, { amount, date })
};
