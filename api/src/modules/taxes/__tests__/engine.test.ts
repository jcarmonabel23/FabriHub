import { describe, expect, it } from "vitest";
import { computeTaxes, pickBracket, type Bracket } from "../engine";

const TARIFA2: Bracket[] = [
  { fromAmount: 0, rate: 6, subtrahend: 0 },
  { fromAmount: 9000, rate: 9, subtrahend: 270 },
  { fromAmount: 13500, rate: 12, subtrahend: 675 }
];

describe("motor fiscal", () => {
  it("IVA general 16% sin retención", () => {
    const r = computeTaxes(1000, 16);
    expect(r).toMatchObject({ amount: 1000, tax: 160, total: 1160, payable: 1160, withholding: null });
  });

  it("exento: impuesto cero", () => {
    expect(computeTaxes(250.5, 0)).toMatchObject({ tax: 0, total: 250.5 });
  });

  it("retención de IVA 75% se calcula sobre el impuesto, no sobre el monto", () => {
    const r = computeTaxes(1000, 16, { baseOn: "tax", brackets: [{ fromAmount: 0, rate: 75, subtrahend: 0 }] });
    expect(r.withholding).toMatchObject({ base: 160, amount: 120 });
    expect(r.payable).toBe(1040);
  });

  it("ISLR por tramos: elige el tramo correcto y resta el sustraendo", () => {
    const r = computeTaxes(10000, 0, { baseOn: "amount", brackets: TARIFA2 });
    expect(r.withholding?.bracket?.fromAmount).toBe(9000);
    expect(r.withholding?.amount).toBe(630); // 10000 × 9% − 270
  });

  it("por debajo del primer tramo (monto mínimo) no se retiene", () => {
    const r = computeTaxes(500, 16, { baseOn: "amount", brackets: [{ fromAmount: 1000, rate: 2, subtrahend: 0 }] });
    expect(r.withholding).toMatchObject({ bracket: null, amount: 0 });
  });

  it("la retención nunca es negativa aunque el sustraendo supere el resultado", () => {
    const r = computeTaxes(9000, 0, { baseOn: "amount", brackets: [{ fromAmount: 0, rate: 1, subtrahend: 500 }] });
    expect(r.withholding?.amount).toBe(0);
  });

  it("redondea a céntimos sin errores de coma flotante", () => {
    // 0.1 + 0.2 en flotante da 0.30000000000000004
    expect(computeTaxes(0.1 + 0.2, 16).tax).toBe(0.05);
    expect(computeTaxes(19.99, 16).tax).toBe(3.2);
  });

  it("el límite del tramo es inclusivo", () => {
    expect(pickBracket(TARIFA2, 13500)?.rate).toBe(12);
    expect(pickBracket(TARIFA2, 13499.99)?.rate).toBe(9);
  });

  it("rechaza montos negativos", () => {
    expect(() => computeTaxes(-1, 16)).toThrow(RangeError);
  });
});
