/**
 * @project FabriHub - API
 * @file src/modules/pos/ticket.ts
 * @description Ticket imprimible del punto de venta (fase 17): datos listos para la plantilla térmica
 * del navegador (58/80 mm) según el país, y bitácora de impresiones (original / COPIA)
 *
 * @overview
 *   GET  /pos/sales/:id/ticket   → datos del ticket, sin efectos (vista previa)
 *   POST /pos/sales/:id/print    → registra la impresión y devuelve el ticket marcado ORIGINAL o COPIA
 * Las leyendas dependen del régimen de cada país:
 *   VE: sin emisor fiscal en la caja, el ticket no es factura fiscal. Con impresora fiscal (fase 19) la
 *       factura es la que imprime la máquina y el ticket es una copia no fiscal con su número; con
 *       imprenta digital el ticket es la representación impresa con el número de control. En
 *       contingencia lleva el número del formato físico.
 *   CR: con comprobantes electrónicos activos (fase 18) el ticket es la representación impresa del
 *       tiquete o la factura electrónica: lleva su consecutivo y su clave (el código QR está
 *       suspendido por Hacienda). Sin ellos, el ticket es provisional.
 */

import type { Request } from "express";
import { one, query, withTx } from "../../db.js";
import { handler, idParams } from "../../lib/http.js";
import { currentCountry } from "../../lib/taxId.js";
import { authOf, txCtx } from "../../security/context.js";
import { companyBranding } from "../settings/branding.js";
import type { SaleEinvoice } from "../einvoice/service.js";
import { taxMark } from "../fiscal/protocol.js";
import type { SaleFiscalDoc } from "../fiscal/service.js";
import { FINAL_CONSUMER, saleDetail, saleOwnerScope } from "./sales.js";

const METHOD_LABEL: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", mobile: "Pago móvil", transfer: "Transferencia" };

function taxLabel(country: string, rate: number): string {
  if (rate === 0) return "Exento";
  if (country === "VE") {
    const name = ({ 16: "general", 8: "reducida", 31: "adicional" } as Record<number, string>)[rate];
    return `IVA ${rate}%${name ? ` (${taxMark(country, rate)})` : ""}`;
  }
  return `IVA ${rate}%`;
}

interface SaleForTicket {
  ticketNumber: string;
  status: string;
  soldAt: string;
  terminalId: string;
  terminalCode: string;
  terminalName: string;
  sessionNumber: string;
  cashierName: string | null;
  customerId: string;
  customerName: string;
  customerRif: string;
  customerAddress: string | null;
  currencyCode: string;
  discountPct: number;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  igtfRate: number;
  igtfBase: number;
  igtfAmount: number;
  grandTotal: number;
  paidAmount: number;
  changeAmount: number;
  changeCurrencyCode: string | null;
  changeInCurrency: number | null;
  taxesDetail: { taxes?: { rate: number; base: number; amount: number }[] } | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: {
    lineNo: number;
    productCode: string;
    productName: string;
    unitCode: string;
    quantity: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
    netAmount: number;
    taxAmount: number;
  }[];
  payments: { method: string; currencyCode: string; amount: number; exchangeRate: number; amountBase: number; reference: string | null }[];
  einvoices: SaleEinvoice[];
  fiscalDocs: SaleFiscalDoc[];
}

const EINV_STATUS: Record<string, string> = {
  pending: "Pendiente de envío a Hacienda",
  sent: "Enviado a Hacienda (en validación)",
  accepted: "Aceptado por Hacienda",
  rejected: "Rechazado por Hacienda",
  cancelled: "No enviado"
};

const FISCAL_STATUS: Record<string, string> = {
  pending: "Documento fiscal por emitir",
  issued: "Emitido",
  contingency: "Emitido en formato de contingencia",
  cancelled: "No emitido"
};

/** Venezuela: qué es el ticket según el emisor y el estado de su documento fiscal */
function fiscalLegends(d: SaleFiscalDoc): string[] {
  if (d.status === "contingency") {
    return ["DOCUMENTO NO FISCAL", `Factura emitida en el formato de contingencia N° ${d.contingencyForm}.`];
  }
  if (d.status !== "issued") return ["DOCUMENTO NO FISCAL", "La factura fiscal de esta venta está en proceso de emisión."];
  if (d.issuer === "printer") {
    return ["COPIA NO FISCAL", `Factura fiscal N° ${d.documentNumber} impresa por la máquina fiscal ${d.machineSerial ?? ""}.`.replace(" .", ".")];
  }
  return ["FACTURA", "Representación impresa del documento emitido por la imprenta digital autorizada."];
}

async function buildTicket(id: string, req: Request) {
  const v = (await saleDetail(id, saleOwnerScope(req))) as unknown as SaleForTicket;
  const [brand, country, terminal, customer, prints] = await Promise.all([
    companyBranding(authOf(req).companyId),
    currentCountry(),
    one<{ width: number; copies: number; auto_print: boolean; footer: string | null }>(
      `SELECT ticket_width_mm AS width, ticket_copies AS copies, auto_print, ticket_footer AS footer FROM pos_terminals WHERE id = $1`,
      [v.terminalId]
    ),
    one<{ code: string; id_type: string }>(`SELECT code, id_type FROM customers WHERE id = $1`, [v.customerId]),
    one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_sales_prints WHERE sale_id = $1`, [id])
  ]);
  const finalConsumer = customer?.code === FINAL_CONSUMER.code;
  const idType = country.idTypes.find((t) => t.code === customer?.id_type);
  const taxes = (v.taxesDetail?.taxes ?? []).map((t) => ({ label: taxLabel(country.code, t.rate), rate: t.rate, base: t.base, amount: t.amount }));

  const doc = v.einvoices.find((d) => d.docType !== "NC") ?? null;
  const creditNote = v.einvoices.find((d) => d.docType === "NC") ?? null;
  const fiscal = v.fiscalDocs.find((d) => d.docType === "FAC") ?? null;
  const fiscalNote = v.fiscalDocs.find((d) => d.docType === "NC") ?? null;
  const legends: string[] = [];
  if (country.code === "VE" && fiscal) {
    legends.push(...fiscalLegends(fiscal));
  } else if (country.code === "VE") {
    legends.push("ESTE DOCUMENTO NO ES UNA FACTURA FISCAL", "No da derecho a crédito fiscal. Solicite su factura.");
  } else if (country.code === "CR" && doc) {
    legends.push(doc.docName.toUpperCase(), "Representación impresa del comprobante electrónico (versión 4.4).");
  } else if (country.code === "CR") {
    legends.push("DOCUMENTO PROVISIONAL", "No sustituye al comprobante electrónico autorizado por el Ministerio de Hacienda.");
  } else {
    legends.push("Comprobante de venta: no es un documento fiscal.");
  }

  return {
    widthMm: terminal?.width ?? 80,
    copies: terminal?.copies ?? 1,
    autoPrint: terminal?.auto_print ?? false,
    printCount: prints?.n ?? 0,
    countryCode: country.code,
    timezone: brand?.timezone ?? country.timezone,
    issuer: {
      name: brand?.name ?? "",
      legalName: brand?.legalName ?? "",
      taxIdLabel: brand?.taxIdLabel ?? country.taxIdLabel,
      taxId: brand?.rif ?? "",
      address: [brand?.address, brand?.city].filter(Boolean).join(", ") || null,
      phones: brand?.phones ?? [],
      email: brand?.email ?? null
    },
    ticketNumber: v.ticketNumber,
    status: v.status,
    soldAt: v.soldAt,
    terminal: `${v.terminalCode} · ${v.terminalName}`,
    sessionNumber: v.sessionNumber,
    cashier: v.cashierName,
    customer: finalConsumer
      ? null
      : { name: v.customerName, idLabel: idType?.name ?? country.taxIdLabel, taxId: v.customerRif, address: v.customerAddress },
    currencyCode: v.currencyCode,
    lines: v.lines.map((l) => ({
      code: l.productCode,
      name: l.productName,
      quantity: l.quantity,
      unitCode: l.unitCode,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      net: l.netAmount,
      taxMark: taxMark(country.code, l.taxRate)
    })),
    subtotal: v.subtotal,
    discountPct: v.discountPct,
    discountAmount: v.discountAmount,
    taxes,
    taxAmount: v.taxAmount,
    total: v.total,
    igtf: v.igtfAmount ? { rate: v.igtfRate, base: v.igtfBase, amount: v.igtfAmount } : null,
    grandTotal: v.grandTotal,
    payments: v.payments.map((p) => ({
      method: METHOD_LABEL[p.method] ?? p.method,
      currencyCode: p.currencyCode,
      amount: p.amount,
      exchangeRate: p.exchangeRate,
      amountBase: p.amountBase,
      reference: p.reference
    })),
    change: v.changeAmount ? { currencyCode: v.changeCurrencyCode ?? v.currencyCode, amount: v.changeInCurrency ?? v.changeAmount } : null,
    voided: v.status === "voided" ? { at: v.voidedAt, reason: v.voidReason } : null,
    einvoice: doc
      ? {
          docType: doc.docType,
          docName: doc.docName,
          consecutive: doc.consecutive,
          clave: doc.clave,
          situation: doc.situation,
          status: doc.status,
          statusLabel: EINV_STATUS[doc.status] ?? doc.status,
          creditNote: creditNote ? { consecutive: creditNote.consecutive, clave: creditNote.clave, status: creditNote.status } : null
        }
      : null,
    fiscal: fiscal
      ? {
          issuer: fiscal.issuer,
          docName: fiscal.docName,
          status: fiscal.status,
          statusLabel: FISCAL_STATUS[fiscal.status] ?? fiscal.status,
          documentNumber: fiscal.documentNumber,
          controlNumber: fiscal.controlNumber,
          machineSerial: fiscal.machineSerial,
          contingencyForm: fiscal.contingencyForm,
          creditNote: fiscalNote
            ? { status: fiscalNote.status, documentNumber: fiscalNote.documentNumber, controlNumber: fiscalNote.controlNumber ?? fiscalNote.contingencyForm }
            : null
        }
      : null,
    legends,
    footer: terminal?.footer ?? null
  };
}

export const getTicket = handler({ params: idParams }, async ({ params, req }) => buildTicket(params.id, req));

/** Registra la impresión (la primera es el original; las demás, copias) y devuelve el ticket a imprimir */
export const printTicket = handler({ params: idParams }, async ({ params, req }) => {
  const ticket = await buildTicket(params.id, req);
  const print = await withTx(txCtx(req), async (client) => {
    // Bloquea la venta: dos impresiones simultáneas no pueden quedar ambas como «original»
    await client.query(`SELECT 1 FROM pos_sales WHERE id = $1 FOR UPDATE`, [params.id]);
    const n = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pos_sales_prints WHERE sale_id = $1`, [params.id], client))[0].n;
    await client.query(
      `INSERT INTO pos_sales_prints (sale_id, print_no, copies, is_copy, printed_by) VALUES ($1, $2, $3, $4, fn_current_app_user())`,
      [params.id, n + 1, ticket.copies, n > 0]
    );
    return { printNo: n + 1, isCopy: n > 0 };
  });
  return { ...ticket, printCount: print.printNo, print };
});
