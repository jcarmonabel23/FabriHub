/**
 * @project FabriHub - Front
 * @file src/app/pos/components/ticket/ticketHtml.ts
 * @description Ticket térmico del POS (fase 17): HTML autónomo con CSS de impresión para papel de
 * 58 u 80 mm, y su impresión mediante un iframe oculto
 *
 * No depende de controladores ni de extensiones: imprime en la impresora predeterminada del equipo
 * (la térmica de la caja). Para imprimir sin el diálogo del navegador, abra Chrome con
 * --kiosk-printing en el equipo de la caja.
 */

import type { PosTicket } from "../../types";

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (v: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const qty = (v: number) => new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 }).format(v);
const rate = (v: number) => new Intl.NumberFormat("es-VE", { maximumFractionDigits: 4 }).format(v);

const row = (left: string, right: string, cls = "") => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;

/** Un ejemplar del ticket */
function ticketBody(t: PosTicket, copyLabel: string | null): string {
  const when = new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short", timeZone: t.timezone }).format(new Date(t.soldAt));
  const c = t.currencyCode;
  const parts: string[] = [];

  parts.push(`<div class="center">
    <div class="big">${esc(t.issuer.name)}</div>
    ${t.issuer.legalName && t.issuer.legalName !== t.issuer.name ? `<div>${esc(t.issuer.legalName)}</div>` : ""}
    <div>${esc(t.issuer.taxIdLabel)} ${esc(t.issuer.taxId)}</div>
    ${t.issuer.address ? `<div>${esc(t.issuer.address)}</div>` : ""}
    ${t.issuer.phones.length ? `<div>Tel. ${esc(t.issuer.phones.join(" / "))}</div>` : ""}
  </div>`);
  parts.push(`<div class="center legend">${esc(t.legends[0])}</div>`);
  if (copyLabel) parts.push(`<div class="center stamp">${esc(copyLabel)}</div>`);
  if (t.voided) parts.push(`<div class="center stamp">ANULADO</div>`);
  parts.push(`<hr/>`);
  parts.push(row("Comprobante", `<b>${esc(t.ticketNumber)}</b>`));
  parts.push(row("Fecha", esc(when)));
  parts.push(row("Caja", esc(t.terminal)));
  parts.push(row("Turno", esc(t.sessionNumber)));
  if (t.cashier) parts.push(row("Cajero", esc(t.cashier)));
  // Costa Rica: representación impresa del comprobante electrónico (el QR está suspendido por Hacienda)
  if (t.einvoice) {
    parts.push(`<hr/>`);
    parts.push(row("Consecutivo", `<b>${esc(t.einvoice.consecutive)}</b>`));
    parts.push(`<div class="small">Clave:</div><div class="clave">${esc(t.einvoice.clave)}</div>`);
    if (t.einvoice.situation !== "1") parts.push(`<div class="small">Emitido en contingencia</div>`);
    parts.push(`<div class="small">${esc(t.einvoice.statusLabel)}</div>`);
    if (t.einvoice.creditNote) {
      parts.push(`<div class="small">Anulado con nota de crédito ${esc(t.einvoice.creditNote.consecutive)}</div>`);
    }
  }
  parts.push(`<hr/>`);
  if (t.customer) {
    parts.push(`<div>Cliente: ${esc(t.customer.name)}</div><div>${esc(t.customer.idLabel)}: ${esc(t.customer.taxId)}</div>`);
    if (t.customer.address) parts.push(`<div>${esc(t.customer.address)}</div>`);
  } else {
    parts.push(`<div>Cliente: Consumidor final</div>`);
  }
  parts.push(`<hr/>`);

  for (const l of t.lines) {
    parts.push(`<div class="item">${esc(l.name)}</div>`);
    parts.push(
      row(
        `&nbsp;${qty(l.quantity)} ${esc(l.unitCode)} x ${money(l.unitPrice)}${l.discountPct ? ` -${qty(l.discountPct)}%` : ""}`,
        `${money(l.net)} ${esc(l.taxMark)}`
      )
    );
  }
  parts.push(`<hr/>`);
  parts.push(row("Subtotal", money(t.subtotal)));
  if (t.discountAmount) parts.push(row(`Descuento${t.discountPct ? ` ${qty(t.discountPct)}%` : ""}`, `-${money(t.discountAmount)}`));
  for (const x of t.taxes) {
    parts.push(row(`Base ${esc(x.label)}`, money(x.base)));
    if (x.rate) parts.push(row(esc(x.label), money(x.amount)));
  }
  if (t.igtf) {
    parts.push(row("Total", money(t.total)));
    parts.push(row(`IGTF ${qty(t.igtf.rate)}% s/ ${money(t.igtf.base)}`, money(t.igtf.amount)));
  }
  parts.push(row(`TOTAL ${esc(c)}`, money(t.grandTotal), "total"));
  parts.push(`<hr/>`);

  for (const p of t.payments) {
    parts.push(row(`${esc(p.method)} ${esc(p.currencyCode)}`, money(p.amount)));
    if (p.exchangeRate !== 1) parts.push(row(`&nbsp;tasa ${rate(p.exchangeRate)}`, `${esc(c)} ${money(p.amountBase)}`, "small"));
    if (p.reference) parts.push(`<div class="small">&nbsp;ref. ${esc(p.reference)}</div>`);
  }
  if (t.change) parts.push(row(`Vuelto ${esc(t.change.currencyCode)}`, money(t.change.amount)));
  if (t.voided?.reason) parts.push(`<hr/><div>Anulado: ${esc(t.voided.reason)}</div>`);

  parts.push(`<hr/>`);
  for (const lg of t.legends.slice(1)) parts.push(`<div class="center small">${esc(lg)}</div>`);
  if (t.footer) parts.push(`<div class="center">${esc(t.footer)}</div>`);
  parts.push(`<div class="center">¡Gracias por su compra!</div>`);
  return `<section class="ticket">${parts.join("\n")}</section>`;
}

export interface TicketPrintOptions {
  /** Reimpresión: cada ejemplar sale marcado «COPIA» */
  isCopy?: boolean;
  /** Ejemplares (por defecto los de la caja) */
  copies?: number;
}

/** Documento HTML completo (todos los ejemplares, uno por página) */
export function ticketHtml(t: PosTicket, opts: TicketPrintOptions = {}): string {
  const copies = Math.min(3, Math.max(1, opts.copies ?? t.copies));
  // Área imprimible típica: 48 mm en papel de 58, 72 mm en papel de 80
  const content = t.widthMm === 58 ? 48 : 72;
  const font = t.widthMm === 58 ? 10 : 12;
  const bodies = Array.from({ length: copies }, (_, i) =>
    ticketBody(t, opts.isCopy ? "COPIA" : copies > 1 && i > 0 ? `EJEMPLAR ${i + 1}` : null)
  );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(t.ticketNumber)}</title><style>
@page { size: ${t.widthMm}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: "Courier New", ui-monospace, monospace; font-size: ${font}px; line-height: 1.25; }
.ticket { width: ${content}mm; margin: 0 auto; padding: 2mm 0 6mm; page-break-after: always; break-after: page; }
.ticket:last-child { page-break-after: auto; break-after: auto; }
.center { text-align: center; }
.big { font-size: 1.3em; font-weight: 700; }
.legend { font-weight: 700; margin-top: 1.5mm; }
.stamp { font-size: 1.3em; font-weight: 700; border: 1px solid #000; margin: 1.5mm 6mm; }
.row { display: flex; justify-content: space-between; gap: 2mm; }
.row span:last-child { text-align: right; white-space: nowrap; }
.item { margin-top: 0.8mm; word-break: break-word; }
.total { font-size: 1.25em; font-weight: 700; margin-top: 1mm; }
.small { font-size: 0.85em; }
.clave { font-size: 0.85em; letter-spacing: 0.02em; word-break: break-all; }
hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
</style></head><body>${bodies.join("\n")}</body></html>`;
}

/** Imprime el HTML en un iframe oculto (no abre ventanas ni pestañas) */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const done = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return done();
      win.onafterprint = done;
      win.focus();
      win.print();
      // Algunos navegadores no disparan afterprint: se limpia igual
      setTimeout(done, 60_000);
    };
    frame.srcdoc = html;
  });
}
