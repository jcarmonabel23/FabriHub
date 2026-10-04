/**
 * @project FabriHub - Front
 * @file src/app/settings/services/settings.service.ts
 * @description Llamadas a /settings/* y /lookups/*
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type { CatalogItem, Company, LookupItem, Parameter, Rate, Sequence } from "../types";

export const settingsApi = {
  // Catálogos comerciales (motor genérico)
  listCatalog: (key: string) => apiGet<CatalogItem[]>(`/settings/catalogs/${key}`),
  createCatalogItem: (key: string, body: Record<string, unknown>) => apiPost<CatalogItem>(`/settings/catalogs/${key}`, body),
  updateCatalogItem: (key: string, id: string, body: Record<string, unknown>) =>
    apiPatch<CatalogItem>(`/settings/catalogs/${key}/${id}`, body),
  deleteCatalogItem: (key: string, id: string) => apiDelete<void>(`/settings/catalogs/${key}/${id}`),

  // Tasas de cambio
  listRates: (currencyId: string) => apiGet<Rate[]>(`/settings/currencies/${currencyId}/rates`),
  upsertRate: (currencyId: string, body: { rateDate: string; rate: number; source?: string }) =>
    apiPost<void>(`/settings/currencies/${currencyId}/rates`, body),
  deleteRate: (rateId: string) => apiDelete<void>(`/settings/currencies/rates/${rateId}`),

  // Empresa
  getCompany: () => apiGet<Company>("/settings/company"),
  updateCompany: (body: Omit<Company, "baseCurrencyCode" | "updatedAt">) => apiPut<Company>("/settings/company", body),

  // Parámetros
  listParameters: () => apiGet<Parameter[]>("/settings/parameters"),
  updateParameter: (id: string, value: unknown) => apiPatch<Parameter>(`/settings/parameters/${id}`, { value }),
  resetParameter: (id: string) => apiPost<Parameter>(`/settings/parameters/${id}/reset`),
  listSequences: () => apiGet<Sequence[]>("/settings/sequences"),
  updateSequence: (docType: string, body: Partial<Pick<Sequence, "prefix" | "padding" | "nextNumber">>) =>
    apiPatch<Sequence>(`/settings/sequences/${docType}`, body),

  // Opciones para selects de cualquier módulo
  lookup: (catalog: string, appliesTo?: "purchases" | "sales") => apiGet<LookupItem[]>(`/lookups/${catalog}`, { appliesTo })
};
