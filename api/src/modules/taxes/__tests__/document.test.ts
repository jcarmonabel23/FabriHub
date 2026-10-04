import { describe, expect, it } from "vitest";
import { computeDocument, resolveTreatment, type TreatmentInfo } from "../document";

const RIVA75 = { rateId: "riva75", label: "RIVA 75%", baseOn: "tax" as const, brackets: [{ fromAmount: 0, rate: 75, subtrahend: 0 }] };
const ISLR = {
  rateId: "islr",
  label: "ISLR",
  baseOn: "amount" as const,
  brackets: [
    { fromAmount: 0, rate: 1, subtrahend: 0 },
    { fromAmount: 1000, rate: 3, subtrahend: 10 }
  ]
};

const t = (id: string, calcMethod: TreatmentInfo["calcMethod"], taxRate: number, withholding: TreatmentInfo["withholding"] = null): TreatmentInfo => ({
  id,
  code: id,
  calcMethod,
  taxRate,
  withholding
});

describe("resolveTreatment", () => {
  it("producto exento + proveedor 'both' con RIVA: impuesto del producto (0%), retención del proveedor", () => {
    const r = resolveTreatment(t("EXENTO", "product", 0), t("G16_RIVA75", "both", 16, RIVA75), true);
    expect(r).toMatchObject({ treatmentId: "EXENTO", taxRate: 0 });
    expect(r.withholding?.rateId).toBe("riva75");
  });

  it("proveedor 'party' manda en el impuesto", () => {
    expect(resolveTreatment(t("EXENTO", "product", 0), t("P16", "party", 16), true).taxRate).toBe(16);
  });

  it("sin tratamiento en el producto se usa el de la contraparte", () => {
    expect(resolveTreatment(null, t("G16_RIVA75", "both", 16, RIVA75), true)).toMatchObject({ taxRate: 16 });
  });

  it("si la empresa no es agente de retención, no hay retención", () => {
    expect(resolveTreatment(null, t("G16_RIVA75", "both", 16, RIVA75), false).withholding).toBeNull();
  });

  it("sin tratamientos: alícuota 0", () => {
    expect(resolveTreatment(null, null, true)).toEqual({ treatmentId: null, taxRate: 0, withholding: null });
  });
});

describe("computeDocument", () => {
  it("descuento de línea y global, IVA por alícuota", () => {
    const d = computeDocument(
      [
        { quantity: 10, unitPrice: 100, discountPct: 10, taxRate: 16, withholding: null }, // 900
        { quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 0, withholding: null } // 100
      ],
      5
    );
    expect(d.subtotal).toBe(1000);
    expect(d.discountAmount).toBe(50);
    expect(d.taxableAmount).toBe(950);
    expect(d.taxes).toEqual([
      { rate: 16, base: 855, amount: 136.8 },
      { rate: 0, base: 95, amount: 0 }
    ]);
    expect(d.total).toBe(1086.8);
  });

  it("la retención de IVA se calcula sobre el impuesto del documento", () => {
    const d = computeDocument([{ quantity: 1, unitPrice: 1000, discountPct: 0, taxRate: 16, withholding: RIVA75 }]);
    expect(d.withholdings[0]).toMatchObject({ base: 160, amount: 120 });
    expect(d.payable).toBe(1040);
  });

  it("los tramos del ISLR se aplican al TOTAL del documento, no por línea", () => {
    // Por línea: 600 y 600 caerían en el tramo de 1%. Sumados (1200) caen en el de 3% − 10.
    const d = computeDocument([
      { quantity: 1, unitPrice: 600, discountPct: 0, taxRate: 0, withholding: ISLR },
      { quantity: 1, unitPrice: 600, discountPct: 0, taxRate: 0, withholding: ISLR }
    ]);
    expect(d.withholdings).toHaveLength(1);
    expect(d.withholdings[0]).toMatchObject({ base: 1200, amount: 26 });
  });

  it("cuadra en céntimos: total = base + impuestos y a pagar = total − retenciones", () => {
    const d = computeDocument([
      { quantity: 3, unitPrice: 19.99, discountPct: 7.5, taxRate: 16, withholding: RIVA75 },
      { quantity: 7, unitPrice: 0.333, discountPct: 0, taxRate: 8, withholding: null }
    ]);
    expect(Math.round((d.taxableAmount + d.taxAmount) * 100)).toBe(Math.round(d.total * 100));
    expect(Math.round((d.total - d.withholdingAmount) * 100)).toBe(Math.round(d.payable * 100));
  });
});
