/**
 * @project FabriHub - Front
 * @file src/app/settings/types.ts
 * @description Modelos de Parámetros del Sistema
 */

import type { CompanyBranding } from "@auth/types";

export type AppliesTo = "purchases" | "sales" | "both";

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  orderList: number;
  updatedAt: string;
  [extra: string]: unknown;
}

export interface Rate {
  id: string;
  rateDate: string;
  rate: number;
  source: string | null;
  /** La registró la consulta automática (BCV/BCCR); una corrección manual la vuelve manual */
  isAutomatic: boolean;
  valueDate: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Tasas automáticas (fase 16) */
export interface RateRun {
  id: string;
  provider: string;
  trigger: "schedule" | "manual";
  status: "running" | "ok" | "partial" | "error";
  message: string | null;
  rates: { currency: string; rateDate: string; rate: number; action: "inserted" | "updated" | "unchanged" | "kept_manual" | "reference" }[];
  startedAt: string;
  finishedAt: string | null;
  createdBy: string | null;
}

export interface RatesStatus {
  provider: { code: string; name: string; needsToken: boolean } | null;
  autoEnabled: boolean;
  intervalHours: number;
  bccrSide: "sell" | "buy" | null;
  token: { configured: boolean; hint: string | null; updatedAt: string | null } | null;
  runs: RateRun[];
}

export interface Company {
  legalName: string;
  tradeName: string | null;
  /** Tipo de identificación fiscal (RIF en VE; JURIDICA, FISICA… en CR) */
  idType: string;
  rif: string;
  address: string | null;
  city: string | null;
  state: string | null;
  /** País (fase 15): se fija al crear la empresa y no se edita aquí */
  countryCode: string;
  country: string;
  phones: string[];
  email: string | null;
  website: string | null;
  baseCurrencyId: string;
  baseCurrencyCode: string;
  isSpecialTaxpayer: boolean;
  isWithholdingAgent: boolean;
  fiscalYearStartMonth: number;
  updatedAt: string;
  /** Identidad (fase 12): el color se guarda con el formulario; logo e ícono se suben aparte */
  brandColor: string | null;
  logo: CompanyBranding["logo"];
  icon: CompanyBranding["icon"];
}

export interface Parameter {
  id: string;
  moduleCode: string;
  moduleName: string;
  key: string;
  name: string;
  description: string | null;
  dataType: "string" | "integer" | "number" | "boolean" | "select";
  value: unknown;
  defaultValue: unknown;
  rules: { min?: number; max?: number; maxLength?: number; options?: { value: string; label: string }[] };
  updatedAt: string;
  updatedBy: string | null;
}

export interface Sequence {
  docType: string;
  name: string;
  moduleCode: string;
  moduleName: string;
  prefix: string;
  padding: number;
  nextNumber: number;
  preview: string;
  updatedAt: string;
}

export interface LookupItem {
  id: string;
  code: string;
  name: string;
  [extra: string]: unknown;
}
