/**
 * @project FabriHub - API
 * @file src/lib/pdf.ts
 * @description Documentos PDF con la identidad de la empresa (pedidos, notas de entrega y, luego, tickets)
 *
 * @overview
 * Un solo diseño para todos los documentos: cabecera con logo y datos fiscales de la empresa,
 * título y número, recuadros de contraparte y datos del documento, tabla de líneas (repite su
 * encabezado al cambiar de página), totales, notas, firmas y pie con la paginación.
 * Usa las fuentes estándar de PDF (Helvetica, WinAnsi): cubren los acentos y la ñ.
 */

import PDFDocument from "pdfkit";
import type { Branding } from "../modules/settings/branding.js";

export interface PdfColumn {
  header: string;
  /** Proporción del ancho útil */
  width: number;
  align?: "left" | "right" | "center";
}

export interface PdfDocumentSpec {
  brand: Branding | null;
  title: string;
  number: string;
  /** Sello visible en estados especiales (p. ej. «ANULADA», «BORRADOR») */
  stamp?: string | null;
  party: { label: string; name: string; rif?: string | null; lines?: (string | null | undefined)[] };
  meta: [string, string][];
  columns: PdfColumn[];
  rows: string[][];
  totals?: [string, string][];
  notes?: string | null;
  signatures?: string[];
  issuedBy: string;
}

const MARGIN = 40;
const GRAY = "#6b7280";
const LINE = "#e5e7eb";
const TEXT = "#111827";

const money = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 6 });
export const fmtMoney = (v: number | null | undefined) => (v === null || v === undefined ? "—" : money.format(v));
export const fmtQty = (v: number | null | undefined) => (v === null || v === undefined ? "—" : qty.format(v));
export const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

/**
 * @function renderPdf
 * @description Genera el PDF completo en memoria
 */
export function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: `${spec.title} ${spec.number}`, Author: spec.brand?.legalName ?? "FabriHub", Creator: "FabriHub" }
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const brand = spec.brand;
  const color = brand?.brandColor ?? "#167c94";
  const left = MARGIN;
  const width = doc.page.width - MARGIN * 2;
  const right = left + width;

  // ---------------------------------------------------------------- Cabecera de la empresa
  let y = MARGIN;
  const infoX = left + width * 0.45;
  if (brand?.logo) {
    doc.image(brand.logo.png, left, y, { fit: [width * 0.4, 60] });
  } else {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(color).text(brand?.name ?? "FabriHub", left, y + 10, { width: width * 0.42 });
  }
  if (brand) {
    const info = [
      `RIF ${brand.rif}`,
      brand.address,
      [brand.city, brand.phones.join(" / ")].filter(Boolean).join(" · ") || null,
      brand.email
    ].filter(Boolean) as string[];
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT).text(brand.legalName, infoX, y, { width: right - infoX, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor(GRAY).text(info.join("\n"), infoX, doc.y + 2, { width: right - infoX, align: "right" });
  }
  y = Math.max(y + 64, doc.y + 8);
  doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(color).stroke();
  y += 14;

  // ---------------------------------------------------------------- Título
  doc.font("Helvetica-Bold").fontSize(16).fillColor(TEXT).text(spec.title, left, y);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(color).text(`N.º ${spec.number}`, left, y + 2, { width, align: "right" });
  y = doc.y + 10;
  if (spec.stamp) {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(60).fillColor("#dc2626").opacity(0.12);
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.text(spec.stamp, 0, doc.page.height / 2 - 30, { width: doc.page.width, align: "center" });
    doc.restore();
  }

  // ---------------------------------------------------------------- Contraparte y datos del documento
  const boxTop = y;
  const half = (width - 12) / 2;
  const partyLines = [spec.party.rif ? `RIF ${spec.party.rif}` : null, ...(spec.party.lines ?? [])].filter(Boolean) as string[];
  doc.font("Helvetica-Bold").fontSize(7).fillColor(GRAY).text(spec.party.label.toUpperCase(), left + 8, boxTop + 7, { width: half - 16 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(TEXT).text(spec.party.name, left + 8, doc.y + 2, { width: half - 16 });
  doc.font("Helvetica").fontSize(8).fillColor("#374151").text(partyLines.join("\n"), left + 8, doc.y + 1, { width: half - 16 });
  const partyBottom = doc.y;

  const mx = left + half + 12;
  let my = boxTop + 7;
  doc.fontSize(8);
  for (const [label, value] of spec.meta) {
    doc.font("Helvetica").fillColor(GRAY).text(label, mx + 8, my, { width: half * 0.42 });
    doc.font("Helvetica-Bold").fillColor(TEXT).text(value || "—", mx + 8 + half * 0.42, my, { width: half * 0.58 - 16 });
    my = Math.max(doc.y, my + 11) + 1;
  }
  const boxBottom = Math.max(partyBottom, my) + 7;
  doc.lineWidth(0.8).strokeColor(LINE);
  doc.roundedRect(left, boxTop, half, boxBottom - boxTop, 4).stroke();
  doc.roundedRect(mx, boxTop, half, boxBottom - boxTop, 4).stroke();
  y = boxBottom + 16;

  // ---------------------------------------------------------------- Tabla de líneas
  const cols = spec.columns.map((c) => ({ ...c, w: c.width * width }));
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 10;
  const drawHeader = () => {
    doc.rect(left, y, width, 18).fill(color);
    let x = left;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    for (const c of cols) {
      doc.text(c.header, x + 4, y + 5, { width: c.w - 8, align: c.align ?? "left", lineBreak: false });
      x += c.w;
    }
    y += 18;
  };
  drawHeader();
  doc.font("Helvetica").fontSize(8);
  spec.rows.forEach((row, i) => {
    const h = Math.max(...row.map((cell, j) => doc.heightOfString(cell, { width: cols[j].w - 8 }))) + 8;
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
      drawHeader();
      doc.font("Helvetica").fontSize(8);
    }
    if (i % 2 === 1) doc.rect(left, y, width, h).fill("#f9fafb");
    let x = left;
    doc.fillColor(TEXT);
    row.forEach((cell, j) => {
      doc.text(cell, x + 4, y + 4, { width: cols[j].w - 8, align: cols[j].align ?? "left" });
      x += cols[j].w;
    });
    y += h;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
  });
  if (!spec.rows.length) {
    doc.fillColor(GRAY).text("Sin líneas", left, y + 6, { width, align: "center" });
    y += 22;
  }
  y += 10;

  // ---------------------------------------------------------------- Totales
  if (spec.totals?.length) {
    const tw = width * 0.42;
    const tx = right - tw;
    if (y + spec.totals.length * 15 > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
    }
    spec.totals.forEach(([label, value], i) => {
      const lastRow = i === spec.totals!.length - 1;
      if (lastRow) {
        doc.rect(tx, y - 2, tw, 17).fill(color);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
      } else {
        doc.fillColor(TEXT).font("Helvetica").fontSize(9);
      }
      doc.text(label, tx + 6, y + 1, { width: tw * 0.55 });
      doc.text(value, tx + tw * 0.45, y + 1, { width: tw * 0.55 - 6, align: "right" });
      y += lastRow ? 19 : 14;
    });
    y += 6;
  }

  // ---------------------------------------------------------------- Notas y firmas
  if (spec.notes) {
    const h = doc.font("Helvetica").fontSize(8).heightOfString(spec.notes, { width }) + 16;
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
    }
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRAY).text("NOTAS", left, y);
    doc.font("Helvetica").fontSize(8).fillColor("#374151").text(spec.notes, left, doc.y + 2, { width });
    y = doc.y + 12;
  }
  if (spec.signatures?.length) {
    if (y + 70 > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
    }
    const sw = (width - (spec.signatures.length - 1) * 24) / spec.signatures.length;
    const sy = Math.max(y + 40, bottomLimit() - 30);
    spec.signatures.forEach((label, i) => {
      const sx = left + i * (sw + 24);
      doc.moveTo(sx, sy).lineTo(sx + sw, sy).lineWidth(0.8).strokeColor("#9ca3af").stroke();
      doc.font("Helvetica").fontSize(8).fillColor(GRAY).text(label, sx, sy + 4, { width: sw, align: "center" });
    });
  }

  // ---------------------------------------------------------------- Pie en todas las páginas
  const issued = new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Caracas" }).format(new Date());
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // El pie va dentro del margen inferior: sin bajarlo, pdfkit abriría una página nueva
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - MARGIN;
    doc.font("Helvetica").fontSize(7).fillColor("#9ca3af");
    doc.text(`Emitido el ${issued} por ${spec.issuedBy} · FabriHub`, left, fy, { width: width * 0.7, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, left, fy, { width, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
