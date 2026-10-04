/**
 * @project FabriHub - API
 * @file src/modules/taxes/engine.ts
 * @description Motor de cálculo fiscal (puro, sin BD): impuesto + retención por tramos
 *
 * @overview
 * Lo usan el simulador de Tratamientos Fiscales y, desde las fases 4 y 6, las líneas de
 * órdenes de compra y venta. Todo se calcula en CÉNTIMOS enteros para no arrastrar errores
 * de coma flotante; el redondeo es "mitad hacia arriba" a 2 decimales.
 *
 *   impuesto  = base × tasa%
 *   retención = max(0, baseRetención × tasaTramo% − sustraendo)
 *               baseRetención = monto (ISLR) o impuesto (retención de IVA)
 *               tramo = el de mayor `fromAmount` ≤ baseRetención (si no hay ninguno: 0)
 *   a pagar   = monto + impuesto − retención
 */

export interface Bracket {
  fromAmount: number;
  rate: number;
  subtrahend: number;
}

export interface WithholdingSpec {
  baseOn: "amount" | "tax";
  brackets: Bracket[];
}

export interface TaxBreakdown {
  amount: number;
  taxRate: number;
  tax: number;
  total: number;
  withholding: {
    base: number;
    bracket: Bracket | null;
    amount: number;
  } | null;
  payable: number;
}

const toCents = (v: number): number => Math.round(v * 100);
const fromCents = (c: number): number => c / 100;
/** Porcentaje sobre céntimos, redondeado a céntimo */
const pct = (cents: number, rate: number): number => Math.round((cents * rate) / 100);

/** Tramo aplicable: el de mayor límite inferior que no supere la base */
export function pickBracket(brackets: Bracket[], base: number): Bracket | null {
  return (
    [...brackets].sort((a, b) => b.fromAmount - a.fromAmount).find((b) => base >= b.fromAmount) ?? null
  );
}

export function computeTaxes(amount: number, taxRate: number, withholding?: WithholdingSpec | null): TaxBreakdown {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("El monto debe ser un número no negativo");
  if (taxRate < 0 || taxRate > 100) throw new RangeError("La tasa debe estar entre 0 y 100");

  const amountC = toCents(amount);
  const taxC = pct(amountC, taxRate);
  const totalC = amountC + taxC;

  let wh: TaxBreakdown["withholding"] = null;
  let whC = 0;
  if (withholding) {
    const baseC = withholding.baseOn === "tax" ? taxC : amountC;
    const bracket = pickBracket(withholding.brackets, fromCents(baseC));
    if (bracket) whC = Math.max(0, pct(baseC, bracket.rate) - toCents(bracket.subtrahend));
    wh = { base: fromCents(baseC), bracket, amount: fromCents(whC) };
  }

  return {
    amount: fromCents(amountC),
    taxRate,
    tax: fromCents(taxC),
    total: fromCents(totalC),
    withholding: wh,
    payable: fromCents(totalC - whC)
  };
}
