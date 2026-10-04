/**
 * @project FabriHub - API
 * @file src/modules/taxes/document.ts
 * @description Cálculo fiscal de un DOCUMENTO (orden de compra/venta): líneas, descuentos,
 * impuestos por alícuota y retenciones agrupadas. Puro: sin BD, probado en __tests__.
 *
 * @overview
 * 1. Neto de línea = cantidad × precio × (1 − desc. línea) × (1 − desc. global), en céntimos.
 * 2. Impuesto de línea = neto × alícuota de su tratamiento.
 * 3. Retenciones: se agrupan por tarifa de retención y se calculan UNA vez sobre la suma de la
 *    base del grupo (monto o impuesto). Así los tramos y sustraendos del ISLR se aplican al
 *    documento completo, como exige la norma, y no línea por línea.
 *
 * Qué tratamiento aplica (`resolveTreatment`), según calc_method (fase 2):
 *   - Impuesto: el del PRODUCTO; si el tratamiento de la contraparte es 'party', el de la contraparte.
 *     Si solo uno existe, ese. Si ninguno, alícuota 0.
 *   - Retención: la de la CONTRAPARTE si su método es 'party' o 'both'; si no, la del producto
 *     cuando su método es 'product'. Solo se aplica si la empresa es agente de retención.
 */

import { pickBracket, type Bracket, type WithholdingSpec } from "./engine.js";

export interface TreatmentInfo {
  id: string;
  code: string;
  calcMethod: "product" | "party" | "both";
  taxRate: number;
  withholding: (WithholdingSpec & { rateId: string; label: string }) | null;
}

export interface ResolvedTreatment {
  treatmentId: string | null;
  taxRate: number;
  withholding: (WithholdingSpec & { rateId: string; label: string }) | null;
}

export function resolveTreatment(
  product: TreatmentInfo | null,
  party: TreatmentInfo | null,
  applyWithholdings: boolean
): ResolvedTreatment {
  const taxSource = party?.calcMethod === "party" ? party : (product ?? party);
  let whSource: TreatmentInfo | null = null;
  if (party && (party.calcMethod === "party" || party.calcMethod === "both")) whSource = party;
  else if (product && product.calcMethod === "product") whSource = product;
  return {
    treatmentId: taxSource?.id ?? null,
    taxRate: taxSource?.taxRate ?? 0,
    withholding: applyWithholdings ? (whSource?.withholding ?? null) : null
  };
}

export interface DocLineInput {
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  withholding: (WithholdingSpec & { rateId: string; label: string }) | null;
}

export interface DocLineResult {
  gross: number;
  net: number;
  tax: number;
}

export interface WithholdingResult {
  rateId: string;
  label: string;
  baseOn: "amount" | "tax";
  base: number;
  bracket: Bracket | null;
  amount: number;
}

export interface DocumentResult {
  lines: DocLineResult[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxes: { rate: number; base: number; amount: number }[];
  taxAmount: number;
  total: number;
  withholdings: WithholdingResult[];
  withholdingAmount: number;
  payable: number;
}

const c = (v: number) => Math.round(v * 100);
const u = (cents: number) => cents / 100;

export function computeDocument(lines: DocLineInput[], globalDiscountPct = 0): DocumentResult {
  if (globalDiscountPct < 0 || globalDiscountPct > 100) throw new RangeError("Descuento global fuera de rango");

  let subtotalC = 0;
  let netTotalC = 0;
  const byRate = new Map<number, { base: number; amount: number }>();
  const byWh = new Map<string, { spec: NonNullable<DocLineInput["withholding"]>; amountBase: number; taxBase: number }>();

  const results = lines.map((l) => {
    if (l.quantity <= 0 || l.unitPrice < 0) throw new RangeError("Cantidad y precio deben ser positivos");
    const grossC = c(l.quantity * l.unitPrice * (1 - l.discountPct / 100));
    const netC = Math.round(grossC * (1 - globalDiscountPct / 100));
    const taxC = Math.round((netC * l.taxRate) / 100);
    subtotalC += grossC;
    netTotalC += netC;

    const r = byRate.get(l.taxRate) ?? { base: 0, amount: 0 };
    r.base += netC;
    r.amount += taxC;
    byRate.set(l.taxRate, r);

    if (l.withholding) {
      const w = byWh.get(l.withholding.rateId) ?? { spec: l.withholding, amountBase: 0, taxBase: 0 };
      w.amountBase += netC;
      w.taxBase += taxC;
      byWh.set(l.withholding.rateId, w);
    }
    return { gross: u(grossC), net: u(netC), tax: u(taxC) };
  });

  const taxes = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => ({ rate, base: u(v.base), amount: u(v.amount) }));
  const taxC = [...byRate.values()].reduce((a, v) => a + v.amount, 0);

  const withholdings: WithholdingResult[] = [...byWh.values()].map((w) => {
    const baseC = w.spec.baseOn === "tax" ? w.taxBase : w.amountBase;
    const bracket = pickBracket(w.spec.brackets, u(baseC));
    const amountC = bracket ? Math.max(0, Math.round((baseC * bracket.rate) / 100) - c(bracket.subtrahend)) : 0;
    return { rateId: w.spec.rateId, label: w.spec.label, baseOn: w.spec.baseOn, base: u(baseC), bracket, amount: u(amountC) };
  });
  const whC = withholdings.reduce((a, w) => a + c(w.amount), 0);

  return {
    lines: results,
    subtotal: u(subtotalC),
    discountAmount: u(subtotalC - netTotalC),
    taxableAmount: u(netTotalC),
    taxes,
    taxAmount: u(taxC),
    total: u(netTotalC + taxC),
    withholdings,
    withholdingAmount: u(whC),
    payable: u(netTotalC + taxC - whC)
  };
}
