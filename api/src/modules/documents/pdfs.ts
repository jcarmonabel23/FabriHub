/**
 * @project FabriHub - API
 * @file src/modules/documents/pdfs.ts
 * @description PDF de documentos comerciales: orden de venta, nota de entrega, orden de compra y comprobante del POS
 *
 * @overview
 * Cada PDF reutiliza el detalle del documento (mismas reglas de visibilidad que su pantalla:
 * dueño de la orden de venta sin view_all, alcance por almacén en notas de entrega) y lo dibuja
 * con lib/pdf.ts y la identidad de la empresa activa.
 */

import type { Response } from "express";
import { handler, idParams } from "../../lib/http.js";
import { fmtDate, fmtMoney, fmtQty, renderPdf, type PdfColumn } from "../../lib/pdf.js";
import { authOf } from "../../security/context.js";
import { warehouseScope } from "../inventory/scope.js";
import { saleDetail, saleOwnerScope } from "../pos/sales.js";
import { orderDetail as purchaseOrderDetail } from "../purchases/orders.js";
import { deliveryDetail } from "../sales/deliveries.js";
import { assertOwner, orderDetail as salesOrderDetail } from "../sales/orders.js";
import { companyBranding } from "../settings/branding.js";

interface TaxesDetail {
  taxes?: { rate: number; base: number; amount: number }[];
  withholdings?: { label: string; amount: number }[];
}

interface OrderTotals {
  currencyCode: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
  withholdingAmount: number;
  taxesDetail: TaxesDetail | null;
}

/** Totales comunes a órdenes de compra y venta (el IVA desglosado por alícuota) */
function orderTotals(o: OrderTotals, balanceLabel: string, balance: number): [string, string][] {
  const c = o.currencyCode;
  const rows: [string, string][] = [[`Subtotal (${c})`, fmtMoney(o.subtotal)]];
  if (o.discountAmount) rows.push(["Descuento", `-${fmtMoney(o.discountAmount)}`]);
  rows.push(["Base imponible", fmtMoney(o.taxableAmount)]);
  const taxes = o.taxesDetail?.taxes ?? [];
  if (taxes.length) for (const t of taxes) rows.push([`IVA ${fmtQty(t.rate)}%`, fmtMoney(t.amount)]);
  else rows.push(["IVA", fmtMoney(o.taxAmount)]);
  if (o.withholdingAmount) {
    rows.push([`Total (${c})`, fmtMoney(o.total)]);
    for (const w of o.taxesDetail?.withholdings ?? []) rows.push([w.label, `-${fmtMoney(w.amount)}`]);
    rows.push([balanceLabel, fmtMoney(balance)]);
  } else {
    rows.push([`Total (${c})`, fmtMoney(o.total)]);
  }
  return rows;
}

const LINE_COLUMNS: PdfColumn[] = [
  { header: "#", width: 0.05, align: "center" },
  { header: "Código", width: 0.13 },
  { header: "Descripción", width: 0.32 },
  { header: "Cant.", width: 0.1, align: "right" },
  { header: "Und.", width: 0.07, align: "center" },
  { header: "Precio", width: 0.11, align: "right" },
  { header: "% Desc.", width: 0.09, align: "right" },
  { header: "Neto", width: 0.13, align: "right" }
];

function sendPdf(res: Response, name: string, pdf: Buffer) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}.pdf"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.end(pdf);
}

type Line = {
  lineNo: number;
  productCode: string;
  productName: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  discountPct: number;
  netAmount: number;
  notes?: string | null;
};
const lineRow = (l: Line) => [
  String(l.lineNo),
  l.productCode,
  l.notes ? `${l.productName}\n${l.notes}` : l.productName,
  fmtQty(l.quantity),
  l.unitCode,
  fmtMoney(l.unitPrice),
  l.discountPct ? fmtQty(l.discountPct) : "—",
  fmtMoney(l.netAmount)
];

const stampOf = (status: string) => (status === "cancelled" ? "ANULADA" : status === "draft" ? "BORRADOR" : null);

// ------------------------------------------------------------------ Orden de venta

export const salesOrderPdf = handler({ params: idParams }, async ({ params, req, res }) => {
  await assertOwner(req, params.id);
  const o = (await salesOrderDetail(params.id)) as unknown as OrderTotals & {
    number: string;
    status: string;
    orderDate: string;
    requestedDate: string | null;
    customerName: string;
    customerRif: string;
    contactName: string | null;
    sellerName: string | null;
    warehouseCode: string;
    deliveryAddress: string | null;
    paymentTermName: string | null;
    exchangeRate: number;
    customerReference: string | null;
    notes: string | null;
    receivable: number;
    lines: Line[];
  };
  const pdf = await renderPdf({
    brand: await companyBranding(authOf(req).companyId),
    title: "Orden de venta",
    number: o.number,
    stamp: stampOf(o.status),
    party: {
      label: "Cliente",
      name: o.customerName,
      rif: o.customerRif,
      lines: [o.contactName ? `Contacto: ${o.contactName}` : null, o.deliveryAddress ? `Entrega: ${o.deliveryAddress}` : null]
    },
    meta: [
      ["Fecha", fmtDate(o.orderDate)],
      ["Entrega solicitada", fmtDate(o.requestedDate)],
      ["Condición de pago", o.paymentTermName ?? "—"],
      ["Moneda / tasa", `${o.currencyCode} · ${fmtQty(o.exchangeRate)}`],
      ["Vendedor", o.sellerName ?? "—"],
      ["Almacén", o.warehouseCode],
      ...(o.customerReference ? [["Referencia del cliente", o.customerReference] as [string, string]] : [])
    ],
    columns: LINE_COLUMNS,
    rows: o.lines.map(lineRow),
    totals: orderTotals(o, "Por cobrar", o.receivable),
    notes: o.notes,
    signatures: ["Elaborado por", "Aprobado por", "Cliente"],
    issuedBy: authOf(req).names
  });
  sendPdf(res, `OV_${o.number}`, pdf);
  return undefined;
});

// ------------------------------------------------------------------ Nota de entrega

export const deliveryNotePdf = handler({ params: idParams }, async ({ params, req, res }) => {
  const n = (await deliveryDetail(params.id, await warehouseScope(req))) as unknown as {
    number: string;
    status: string;
    deliveryDate: string;
    orderNumber: string;
    customerName: string;
    customerRif: string;
    deliveryAddress: string | null;
    carrier: string | null;
    warehouseCode: string;
    movementNumber: string | null;
    currencyCode: string;
    netAmount: number;
    notes: string | null;
    lines: {
      lineNo: number;
      productCode: string;
      productName: string;
      quantity: number;
      unitCode: string;
      unitPrice: number;
      lotCode: string | null;
      expiresOn: string | null;
    }[];
  };
  const pdf = await renderPdf({
    brand: await companyBranding(authOf(req).companyId),
    title: "Nota de entrega",
    number: n.number,
    stamp: stampOf(n.status),
    party: {
      label: "Cliente",
      name: n.customerName,
      rif: n.customerRif,
      lines: [n.deliveryAddress ? `Entrega: ${n.deliveryAddress}` : null]
    },
    meta: [
      ["Fecha", fmtDate(n.deliveryDate)],
      ["Orden de venta", n.orderNumber],
      ["Almacén", n.warehouseCode],
      ["Transportista", n.carrier ?? "—"],
      ["Movimiento", n.movementNumber ?? "—"]
    ],
    columns: [
      { header: "#", width: 0.05, align: "center" },
      { header: "Código", width: 0.15 },
      { header: "Descripción", width: 0.36 },
      { header: "Lote", width: 0.14 },
      { header: "Vence", width: 0.1, align: "center" },
      { header: "Cant.", width: 0.12, align: "right" },
      { header: "Und.", width: 0.08, align: "center" }
    ],
    rows: n.lines.map((l) => [
      String(l.lineNo),
      l.productCode,
      l.productName,
      l.lotCode ?? "—",
      l.expiresOn ? fmtDate(l.expiresOn) : "—",
      fmtQty(l.quantity),
      l.unitCode
    ]),
    totals: [[`Valor neto (${n.currencyCode})`, fmtMoney(n.netAmount)]],
    notes: n.notes,
    signatures: ["Despachado por", "Transportista", "Recibido conforme (nombre, C.I. y fecha)"],
    issuedBy: authOf(req).names
  });
  sendPdf(res, `NE_${n.number}`, pdf);
  return undefined;
});

// ------------------------------------------------------------------ Orden de compra

export const purchaseOrderPdf = handler({ params: idParams }, async ({ params, req, res }) => {
  const o = (await purchaseOrderDetail(params.id)) as unknown as OrderTotals & {
    number: string;
    status: string;
    orderDate: string;
    expectedDate: string | null;
    supplierName: string;
    supplierRif: string;
    contactName: string | null;
    buyerName: string | null;
    warehouseCode: string;
    deliveryAddress: string | null;
    paymentTermName: string | null;
    exchangeRate: number;
    supplierReference: string | null;
    notes: string | null;
    payable: number;
    lines: Line[];
  };
  const pdf = await renderPdf({
    brand: await companyBranding(authOf(req).companyId),
    title: "Orden de compra",
    number: o.number,
    stamp: stampOf(o.status),
    party: {
      label: "Proveedor",
      name: o.supplierName,
      rif: o.supplierRif,
      lines: [o.contactName ? `Contacto: ${o.contactName}` : null]
    },
    meta: [
      ["Fecha", fmtDate(o.orderDate)],
      ["Entrega esperada", fmtDate(o.expectedDate)],
      ["Condición de pago", o.paymentTermName ?? "—"],
      ["Moneda / tasa", `${o.currencyCode} · ${fmtQty(o.exchangeRate)}`],
      ["Comprador", o.buyerName ?? "—"],
      ["Entregar en", o.deliveryAddress || `Almacén ${o.warehouseCode}`],
      ...(o.supplierReference ? [["Referencia del proveedor", o.supplierReference] as [string, string]] : [])
    ],
    columns: LINE_COLUMNS,
    rows: o.lines.map(lineRow),
    totals: orderTotals(o, "Por pagar", o.payable),
    notes: o.notes,
    signatures: ["Elaborado por", "Aprobado por"],
    issuedBy: authOf(req).names
  });
  sendPdf(res, `OC_${o.number}`, pdf);
  return undefined;
});

// ------------------------------------------------------------------ Comprobante del POS

const METHOD_LABEL: Record<string, string> = { cash: "Efectivo", card: "Punto de venta", mobile: "Pago móvil", transfer: "Transferencia" };

export const posTicketPdf = handler({ params: idParams }, async ({ params, req, res }) => {
  const v = (await saleDetail(params.id, saleOwnerScope(req))) as unknown as {
    ticketNumber: string;
    status: string;
    soldAt: string;
    saleDate: string;
    terminalCode: string;
    terminalName: string;
    sessionNumber: string;
    cashierName: string | null;
    customerName: string;
    customerRif: string;
    customerAddress: string | null;
    currencyCode: string;
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    taxAmount: number;
    total: number;
    igtfRate: number;
    igtfAmount: number;
    grandTotal: number;
    changeAmount: number;
    changeCurrencyCode: string | null;
    changeInCurrency: number | null;
    taxesDetail: TaxesDetail | null;
    notes: string | null;
    voidReason: string | null;
    lines: Line[];
    payments: { method: string; currencyCode: string; amount: number; exchangeRate: number; reference: string | null }[];
  };
  const c = v.currencyCode;
  const totals: [string, string][] = [[`Subtotal (${c})`, fmtMoney(v.subtotal)]];
  if (v.discountAmount) totals.push(["Descuento", `-${fmtMoney(v.discountAmount)}`]);
  totals.push(["Base imponible", fmtMoney(v.taxableAmount)]);
  const taxes = v.taxesDetail?.taxes ?? [];
  if (taxes.length) for (const t of taxes) totals.push([`IVA ${fmtQty(t.rate)}%`, fmtMoney(t.amount)]);
  else totals.push(["IVA", fmtMoney(v.taxAmount)]);
  if (v.igtfAmount) {
    totals.push([`Total (${c})`, fmtMoney(v.total)]);
    totals.push([`IGTF ${fmtQty(v.igtfRate)}%`, fmtMoney(v.igtfAmount)]);
  }
  totals.push([`Total a pagar (${c})`, fmtMoney(v.grandTotal)]);

  const paid = v.payments.map(
    (p) =>
      `${METHOD_LABEL[p.method] ?? p.method} ${p.currencyCode} ${fmtMoney(p.amount)}` +
      (p.exchangeRate !== 1 ? ` (tasa ${fmtQty(p.exchangeRate)})` : "") +
      (p.reference ? ` · ref. ${p.reference}` : "")
  );
  const notes = [
    `Pagos: ${paid.join("; ")}.`,
    v.changeAmount ? `Vuelto: ${v.changeCurrencyCode ?? c} ${fmtMoney(v.changeInCurrency ?? v.changeAmount)}.` : null,
    v.voidReason ? `Anulada: ${v.voidReason}` : null,
    v.notes,
    "Este comprobante no es una factura fiscal."
  ].filter(Boolean);

  const pdf = await renderPdf({
    brand: await companyBranding(authOf(req).companyId),
    title: "Comprobante de venta",
    number: v.ticketNumber,
    stamp: v.status === "voided" ? "ANULADA" : null,
    party: {
      label: "Cliente",
      name: v.customerName,
      rif: v.customerRif,
      lines: [v.customerAddress]
    },
    meta: [
      ["Fecha", new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Caracas" }).format(new Date(v.soldAt))],
      ["Caja", `${v.terminalCode} · ${v.terminalName}`],
      ["Turno", v.sessionNumber],
      ["Cajero", v.cashierName ?? "—"]
    ],
    columns: LINE_COLUMNS,
    rows: v.lines.map(lineRow),
    totals,
    notes: notes.join("\n"),
    issuedBy: authOf(req).names
  });
  sendPdf(res, `TK_${v.ticketNumber}`, pdf);
  return undefined;
});
