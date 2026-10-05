/**
 * @project FabriHub - Front
 * @file src/app/production/planning/planning.service.ts
 * @description Llamadas y modelos de /planning (PRD_PLANNING): períodos, planes, MRP y sugerencias
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";

export interface Period {
  id: string;
  code: string;
  name: string;
  year: number;
  status: "open" | "closed";
  notes: string | null;
  salesProducts: number;
  mpsTotal: number;
  lastRun: { id: string; runAt: string; suggestions: number } | null;
}

export interface PlanProduct {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  isManufactured: boolean;
  hasFormula: boolean;
  lotSize: number | null;
  available: number;
  safetyStock: number;
  sales: number[];
  mps: number[];
}

export interface Plans {
  period: Period;
  firstMonth: number | null;
  products: PlanProduct[];
}

export interface Bucket {
  month: number;
  gross: number;
  scheduled: number;
  projected: number;
  net: number;
  receipt: number;
  release: number;
}

export interface MrpRow {
  productId: string;
  code: string;
  name: string;
  unitCode: string;
  level: number;
  leadDays: number;
  buckets: Bucket[];
}

export interface Suggestion {
  id: string;
  kind: "make" | "buy";
  status: "open" | "converted" | "dismissed";
  quantity: number;
  netQuantity: number;
  releaseDate: string;
  dueDate: string;
  isLate: boolean;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  purchaseUnitCode: string | null;
  purchaseFactor: number;
  supplierId: string | null;
  supplierName: string | null;
  warehouseId: string | null;
  warehouseCode: string | null;
  documentModule: string | null;
  documentId: string | null;
  documentNumber: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface MrpRun {
  id: string;
  periodId: string;
  periodCode: string;
  year: number;
  firstMonth: number;
  months: number;
  products: number;
  suggestions: Suggestion[];
  results: MrpRow[];
  params: { horizon: number; scheduledPurchaseLines: number; scheduledProductionOrders: number; quarantineProducts: number };
  runAt: string;
  runBy: string | null;
}

export interface RunSummary {
  id: string;
  runAt: string;
  runBy: string | null;
  firstMonth: number;
  months: number;
  products: number;
  suggestions: number;
  converted: number;
}

type Body = Record<string, unknown>;

export const planningApi = {
  periods: () => apiGet<Period[]>("/planning/periods"),
  createPeriod: (b: Body) => apiPost<Period>("/planning/periods", b),
  updatePeriod: (id: string, b: Body) => apiPatch<Period>(`/planning/periods/${id}`, b),
  deletePeriod: (id: string) => apiDelete<void>(`/planning/periods/${id}`),
  plans: (id: string) => apiGet<Plans>(`/planning/periods/${id}/plans`),
  savePlans: (id: string, type: "sales" | "mps", rows: { productId: string; months: number[] }[]) => apiPut<void>(`/planning/periods/${id}/plans`, { type, rows }),
  removeProduct: (id: string, productId: string) => apiDelete<void>(`/planning/periods/${id}/plans/${productId}`),
  salesFromHistory: (id: string, months: number, growthPct: number) => apiPost<{ products: number }>(`/planning/periods/${id}/sales-from-history`, { months, growthPct }),
  generateMps: (id: string) => apiPost<{ generated: number; skipped: string[]; firstMonth: number }>(`/planning/periods/${id}/mps`, {}),
  runMrp: (id: string) => apiPost<MrpRun>(`/planning/periods/${id}/mrp`, {}),
  runs: (id: string) => apiGet<RunSummary[]>(`/planning/periods/${id}/runs`),
  run: (runId: string) => apiGet<MrpRun>(`/planning/runs/${runId}`),
  updateSuggestion: (id: string, b: Body) => apiPatch<MrpRun>(`/planning/suggestions/${id}`, b),
  dismiss: (id: string) => apiPost<MrpRun>(`/planning/suggestions/${id}/dismiss`, {}),
  convert: (ids: string[]) => apiPost<{ documents: { module: string; number: string; id: string }[]; run: MrpRun }>("/planning/suggestions/convert", { ids })
};
