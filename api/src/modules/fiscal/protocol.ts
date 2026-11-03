/**
 * @project FabriHub - API
 * @file src/modules/fiscal/protocol.ts
 * @description Venezuela (fase 19): documento fiscal canónico y contrato de los emisores fiscales
 *
 * @overview
 * Cada caja tiene un emisor (`FiscalIssuer`): ninguno, impresora fiscal o imprenta digital. Todos
 * reciben el mismo documento (`FiscalPayload`, protocolo 1) y devuelven el mismo resultado
 * (`FiscalResult`). La traducción al formato de cada fabricante o proveedor queda en el emisor:
 *   · impresora fiscal: el agente local de la caja (el navegador le entrega el documento; el
 *     servidor no llega al puerto serie). Ver scripts/fiscal-sim para el protocolo HTTP del agente;
 *   · imprenta digital: el adaptador genérico de ./digital.ts, desde el servidor.
 */

import { one, query, type Db } from "../../db.js";

export type FiscalMode = "none" | "printer" | "digital";
export type FiscalDocType = "FAC" | "NC";

export const FISCAL_DOC_NAMES: Record<FiscalDocType, string> = { FAC: "Factura", NC: "Nota de crédito" };

/** Marca de la alícuota en Venezuela (G general, R reducida, A adicional, E exento) */
export function taxMark(country: string, rate: number): string {
  if (rate === 0) return "E";
  if (country === "VE") return ({ 16: "G", 8: "R", 31: "A" } as Record<number, string>)[rate] ?? `${rate}%`;
  return `${rate}%`;
}

export interface FiscalParty {
  name: string;
  taxId: string;
  address: string | null;
}

export interface FiscalPayload {
  protocol: 1;
  /** Clave de idempotencia: reintentar con el mismo id nunca emite dos documentos */
  id: string;
  type: "invoice" | "credit_note";
  issuedAt: string;
  currency: string;
  issuer: FiscalParty;
  /** null = consumidor final */
  customer: FiscalParty | null;
  terminal: { code: string; ticketNumber: string; cashier: string | null };
  lines: {
    code: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountPct: number;
    net: number;
    taxRate: number;
    taxMark: string;
    tax: number;
  }[];
  totals: {
    subtotal: number;
    discount: number;
    exempt: number;
    taxes: { rate: number; mark: string; base: number; amount: number }[];
    tax: number;
    total: number;
    /** El IGTF percibido se mantiene en el documento */
    igtf: { rate: number; base: number; amount: number } | null;
    grandTotal: number;
  };
  payments: { method: string; currency: string; amount: number; exchangeRate: number; amountBase: number }[];
  /** Nota de crédito: factura que anula */
  reference: { documentNumber: string | null; controlNumber: string | null; machineSerial: string | null; issuedAt: string | null; reason: string } | null;
  /** Imprenta digital: documento emitido antes en formato físico (registro posterior) */
  contingency: { formNumber: string; issuedAt: string } | null;
}

export interface FiscalResult {
  documentNumber: string | null;
  controlNumber: string | null;
  machineSerial: string | null;
  zNumber: number | null;
  issuedAt: string;
  pdfBase64?: string | null;
  pdfUrl?: string | null;
}

/** Contrato común: el agente de la impresora (en el navegador) y la imprenta digital (en la API) */
export interface FiscalIssuer {
  readonly mode: Exclude<FiscalMode, "none">;
  issue(doc: FiscalPayload): Promise<FiscalResult>;
}

interface DocForPayload {
  id: string;
  doc_type: FiscalDocType;
  sale_id: string;
  reference_id: string | null;
  reason: string | null;
  contingency_form: string | null;
  contingency_at_text: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Arma el documento canónico desde la venta (y su factura, si es una nota de crédito) */
export async function payloadOf(doc: DocForPayload, db?: Db): Promise<FiscalPayload> {
  const v = (await one<{
    ticket: string;
    issued: string;
    terminal: string;
    cashier: string | null;
    currency: string;
    customer_code: string;
    customer_name: string;
    customer_rif: string;
    customer_address: string | null;
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
    igtf_rate: string;
    igtf_base: string;
    igtf_amount: string;
    grand_total: string;
    taxes: { taxes?: { rate: number; base: number; amount: number }[] } | null;
    co_name: string;
    co_rif: string;
    co_address: string | null;
  }>(
    `SELECT v.ticket_number AS ticket, to_char(v.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS issued, t.code AS terminal,
            u.names AS cashier, cur.code AS currency, c.code AS customer_code, c.legal_name AS customer_name, c.rif AS customer_rif,
            c.address AS customer_address, v.subtotal, v.discount_amount AS discount, v.tax_amount AS tax, v.total,
            v.igtf_rate, v.igtf_base, v.igtf_amount, v.grand_total, v.taxes_detail AS taxes,
            co.legal_name AS co_name, co.rif AS co_rif, concat_ws(', ', NULLIF(co.address, ''), NULLIF(co.city, '')) AS co_address
       FROM pos_sales v
       JOIN pos_terminals t ON t.id = v.terminal_id
       JOIN customers c ON c.id = v.customer_id
       JOIN catalogs_currencies cur ON cur.id = v.currency_id
       LEFT JOIN users u ON u.id = v.created_by
      CROSS JOIN companies co
      WHERE v.id = $1 AND co.id = fn_current_company()`,
    [doc.sale_id],
    db
  ))!;
  const [lines, payments] = await Promise.all([
    query<{ code: string; name: string; unit: string; quantity: string; unit_price: string; discount_pct: string; rate: string; net: string; tax: string }>(
      `SELECT p.code, p.name, u.code AS unit, d.quantity, d.unit_price, d.discount_pct, d.tax_rate AS rate, d.net_amount AS net, d.tax_amount AS tax
         FROM pos_sales_details d JOIN products p ON p.id = d.product_id JOIN catalogs_units u ON u.id = d.unit_id
        WHERE d.sale_id = $1 ORDER BY d.line_no`,
      [doc.sale_id],
      db
    ),
    query<{ method: string; currency: string; amount: string; rate: string; base: string }>(
      `SELECT p.method, c.code AS currency, p.amount, p.exchange_rate AS rate, p.amount_base AS base
         FROM pos_sales_payments p JOIN catalogs_currencies c ON c.id = p.currency_id WHERE p.sale_id = $1 ORDER BY p.line_no`,
      [doc.sale_id],
      db
    )
  ]);

  let reference: FiscalPayload["reference"] = null;
  if (doc.doc_type === "NC" && doc.reference_id) {
    const ref = (await one<{ document_number: string | null; control_number: string | null; machine_serial: string | null; contingency_form: string | null; issued: string | null }>(
      `SELECT document_number, control_number, machine_serial, contingency_form,
              to_char(COALESCE(issued_at, contingency_at), 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS issued
         FROM fiscal_documents WHERE id = $1`,
      [doc.reference_id],
      db
    ))!;
    reference = {
      documentNumber: ref.document_number,
      controlNumber: ref.control_number ?? ref.contingency_form,
      machineSerial: ref.machine_serial,
      issuedAt: ref.issued,
      reason: doc.reason || "Anulación de la venta"
    };
  }

  const fiscalLines = lines.map((l) => ({
    code: l.code,
    description: l.name,
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPrice: Number(l.unit_price),
    discountPct: Number(l.discount_pct),
    net: Number(l.net),
    taxRate: Number(l.rate),
    taxMark: taxMark("VE", Number(l.rate)),
    tax: Number(l.tax)
  }));
  const igtfAmount = Number(v.igtf_amount);
  return {
    protocol: 1,
    id: doc.id,
    type: doc.doc_type === "NC" ? "credit_note" : "invoice",
    issuedAt: v.issued,
    currency: v.currency,
    issuer: { name: v.co_name, taxId: v.co_rif, address: v.co_address || null },
    customer: v.customer_code === "CONSUMIDOR_FINAL" ? null : { name: v.customer_name, taxId: v.customer_rif, address: v.customer_address },
    terminal: { code: v.terminal, ticketNumber: v.ticket, cashier: v.cashier },
    lines: fiscalLines,
    totals: {
      subtotal: Number(v.subtotal),
      discount: Number(v.discount),
      exempt: r2(fiscalLines.filter((l) => l.taxRate === 0).reduce((a, l) => a + l.net, 0)),
      taxes: (v.taxes?.taxes ?? [])
        .filter((t) => t.rate > 0)
        .map((t) => ({ rate: t.rate, mark: taxMark("VE", t.rate), base: t.base, amount: t.amount })),
      tax: Number(v.tax),
      total: Number(v.total),
      igtf: igtfAmount ? { rate: Number(v.igtf_rate), base: Number(v.igtf_base), amount: igtfAmount } : null,
      grandTotal: Number(v.grand_total)
    },
    payments: payments.map((p) => ({ method: p.method, currency: p.currency, amount: Number(p.amount), exchangeRate: Number(p.rate), amountBase: Number(p.base) })),
    reference,
    contingency: doc.contingency_form ? { formNumber: doc.contingency_form, issuedAt: doc.contingency_at_text ?? v.issued } : null
  };
}
