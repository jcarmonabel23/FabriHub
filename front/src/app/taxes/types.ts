/**
 * @project FabriHub - Front
 * @file src/app/taxes/types.ts
 * @description Modelos del subsistema Impuestos
 */

export interface TaxRate {
  id: string;
  code: string;
  name: string;
  rate: number;
  account: string | null;
  isActive: boolean;
  treatments: number;
}

export interface Tax {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "vat" | "luxury" | "other";
  isActive: boolean;
  rates: TaxRate[];
}

export interface Bracket {
  fromAmount: number;
  rate: number;
  subtrahend: number;
}

export interface WithholdingRate {
  id: string;
  code: string;
  name: string;
  account: string | null;
  isActive: boolean;
  treatments: number;
  brackets: Bracket[];
}

export interface Withholding {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "vat" | "income" | "other";
  baseOn: "amount" | "tax";
  isActive: boolean;
  rates: WithholdingRate[];
}

export interface Treatment {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  calcMethod: "product" | "party" | "both";
  taxRateId: string;
  taxLabel: string;
  taxRate: number;
  withholdingRateId: string | null;
  withholdingLabel: string | null;
  isCurrent: boolean;
}

export interface Simulation {
  treatment: { code: string; name: string };
  date: string;
  amount: number;
  taxRate: number;
  tax: number;
  total: number;
  withholding: { base: number; bracket: Bracket | null; amount: number } | null;
  payable: number;
}

export const TAX_KIND_LABEL: Record<string, string> = { vat: "IVA", luxury: "Lujo", other: "Otro" };
export const WH_KIND_LABEL: Record<string, string> = { vat: "IVA", income: "ISLR", other: "Otra" };
export const BASE_ON_LABEL: Record<string, string> = { amount: "Monto del documento", tax: "Impuesto causado" };
export const CALC_METHOD_LABEL: Record<string, string> = {
  product: "Por producto",
  party: "Por cliente / proveedor",
  both: "Impuesto del producto, retención del cliente / proveedor"
};
