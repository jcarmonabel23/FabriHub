/**
 * @project FabriHub - Front
 * @file src/app/settings/types.ts
 * @description Modelos de Parámetros del Sistema
 */

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
  createdAt: string;
  createdBy: string | null;
}

export interface Company {
  legalName: string;
  tradeName: string | null;
  rif: string;
  address: string | null;
  city: string | null;
  state: string | null;
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
