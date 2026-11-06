/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/fiscal.ts
 * @description Reportes fiscales y de tesorería: libro de ventas, retenciones (VE), comprobantes
 * electrónicos (CR), documentos fiscales y reportes Z (VE) y diferencial cambiario
 *
 * @overview
 * El libro de ventas toma los tickets de la caja (incluidos los anulados, que el libro debe mostrar)
 * con el detalle de impuestos que guardó cada venta. Los reportes de un solo país se ofrecen solo a
 * las empresas de ese país (ReportDef.countries).
 */

import { query } from "../../../db.js";
import { canView, ownerScopeOf } from "../access.js";
import { SALES_MODULES, salesLines } from "./sales.js";
import { type ChartPoint, type ReportDef, type Row, ddmm, eachDay, groupSum, ratio, sum, sumUsd, usdOf } from "./types.js";

interface TaxLine {
  rate: number;
  base: number;
  amount: number;
}

const fmtRate = (rate: number) => `${String(rate).replace(".", ",")} %`;

/** Base e impuesto por alícuota, sumando el detalle guardado en cada fila (`_taxes`) */
function byRate(rows: Row[]): ChartPoint[] {
  const m = new Map<number, { base: number; amount: number }>();
  for (const r of rows) {
    for (const t of (r._taxes as TaxLine[] | null) ?? []) {
      const a = m.get(Number(t.rate)) ?? { base: 0, amount: 0 };
      a.base += Number(t.base);
      a.amount += Number(t.amount);
      m.set(Number(t.rate), a);
    }
  }
  return [...m.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({ label: rate ? `Alícuota ${fmtRate(rate)}` : "Exento", base: Math.round(v.base * 100) / 100, amount: Math.round(v.amount * 100) / 100 }));
}

const EINV_TYPE: Record<string, string> = { FE: "Factura electrónica", TE: "Tiquete electrónico", NC: "Nota de crédito" };
const EINV_STATUS: Record<string, string> = { pending: "Pendiente", sent: "Enviado", accepted: "Aceptado", rejected: "Rechazado", cancelled: "Anulado" };
const EINV_SITUATION: Record<string, string> = { "1": "Normal", "2": "Contingencia", "3": "Sin internet" };
const FISCAL_STATUS: Record<string, string> = { pending: "Pendiente", issued: "Emitido", contingency: "Contingencia", cancelled: "Anulado" };

export const FISCAL_REPORTS: ReportDef[] = [
  {
    code: "SALES_BOOK",
    name: "Libro de ventas",
    description: "Tickets de la caja en el rango, con su documento fiscal: base exenta, base gravada e impuesto por alícuota, IGTF y total. Los anulados aparecen en cero.",
    group: "Fiscal y tesorería",
    module: "POS_SALES",
    ranged: true,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "ticket", header: "Ticket", type: "text", width: 16 },
      { key: "fiscalNumber", header: "N.º fiscal", type: "text", width: 20 },
      { key: "controlNumber", header: "N.º de control", type: "text", width: 16 },
      { key: "customer", header: "Cliente", type: "text", width: 30 },
      { key: "taxId", header: "Identificación", type: "text", width: 16 },
      { key: "status", header: "Estado", type: "text", width: 10 },
      { key: "exempt", header: "Base exenta", type: "money", total: true },
      { key: "taxed", header: "Base gravada", type: "money", total: true },
      { key: "rates", header: "Alícuotas", type: "text", width: 14 },
      { key: "tax", header: "Impuesto", type: "money", total: true },
      { key: "igtf", header: "IGTF", type: "money", total: true },
      { key: "total", header: "Total", type: "money", total: true },
      { key: "totalUsd", header: "Total USD", type: "money", usd: true, total: true }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(s.sale_date, 'YYYY-MM-DD') AS day, s.ticket_number AS ticket, s.status AS _status,
                  COALESCE(fd.document_number, ed.consecutive) AS "fiscalNumber", fd.control_number AS "controlNumber",
                  COALESCE(c.trade_name, c.legal_name) AS customer, c.rif AS "taxId",
                  COALESCE(s.taxes_detail -> 'taxes', '[]'::jsonb) AS _taxes,
                  s.igtf_amount::float AS igtf, s.grand_total::float AS total, fn_rate_on('USD', s.sale_date)::float AS _usd
             FROM pos_sales s
             LEFT JOIN customers c ON c.id = s.customer_id
             LEFT JOIN LATERAL (SELECT f.document_number, f.control_number FROM fiscal_documents f
                                 WHERE f.sale_id = s.id AND f.doc_type = 'FAC' AND f.status <> 'cancelled' ORDER BY f.created_at DESC LIMIT 1) fd ON TRUE
             LEFT JOIN LATERAL (SELECT e.consecutive FROM einvoice_documents e
                                 WHERE e.sale_id = s.id AND e.doc_type IN ('FE', 'TE') ORDER BY e.created_at DESC LIMIT 1) ed ON TRUE
            WHERE s.sale_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.created_by = $3)
            ORDER BY s.sale_date, s.ticket_number`,
          [from, to, ownerScopeOf(access, "POS_SALES", userId)]
        )
      ).map((r) => {
        const voided = r._status === "voided";
        const taxes = voided ? [] : ((r._taxes as TaxLine[]) ?? []);
        const total = voided ? 0 : Number(r.total);
        return {
          ...r,
          status: voided ? "Anulado" : "Emitido",
          exempt: taxes.filter((t) => !Number(t.rate)).reduce((s, t) => s + Number(t.base), 0),
          taxed: taxes.filter((t) => Number(t.rate)).reduce((s, t) => s + Number(t.base), 0),
          rates: taxes.length ? taxes.map((t) => (Number(t.rate) ? fmtRate(Number(t.rate)) : "Exento")).join(" · ") : null,
          tax: taxes.reduce((s, t) => s + Number(t.amount), 0),
          igtf: voided ? 0 : Number(r.igtf),
          total,
          totalUsd: usdOf(total, r._usd),
          _taxes: taxes
        };
      }),
    kpis: [
      { key: "documents", label: "Documentos emitidos", type: "int", value: (r) => r.filter((x) => x.status !== "Anulado").length },
      { key: "voided", label: "Anulados", type: "int", value: (r) => r.filter((x) => x.status === "Anulado").length, better: "down" },
      { key: "taxed", label: "Base gravada", type: "money", value: (r) => sum(r, "taxed"), usd: (r) => sumUsd(r, "taxed") },
      { key: "exempt", label: "Base exenta", type: "money", value: (r) => sum(r, "exempt"), usd: (r) => sumUsd(r, "exempt") },
      { key: "tax", label: "Impuesto", type: "money", value: (r) => sum(r, "tax"), usd: (r) => sumUsd(r, "tax") },
      { key: "igtf", label: "IGTF", type: "money", value: (r) => sum(r, "igtf"), usd: (r) => sumUsd(r, "igtf") }
    ],
    charts: [
      {
        title: "Base por alícuota",
        kind: "donut",
        type: "money",
        series: [{ key: "base", label: "Base" }],
        data: byRate
      },
      {
        title: "Impuesto por alícuota",
        kind: "bar",
        type: "money",
        series: [{ key: "amount", label: "Impuesto" }],
        data: (rows) => byRate(rows).filter((p) => Number(p.amount) > 0)
      }
    ]
  },
  {
    code: "WITHHOLDINGS",
    name: "Retenciones del período",
    description: "Retenciones de IVA e ISLR de las órdenes del rango: las que la empresa practica a sus proveedores y las que le practican sus clientes, para declarar.",
    group: "Fiscal y tesorería",
    countries: ["VE"],
    module: ["PUR_ORDERS", "SAL_ORDERS"],
    ranged: true,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "kind", header: "Tipo", type: "text", width: 14 },
      { key: "document", header: "Documento", type: "text", width: 16 },
      { key: "party", header: "Proveedor / cliente", type: "text", width: 30 },
      { key: "taxId", header: "RIF", type: "text", width: 14 },
      { key: "concept", header: "Concepto", type: "text", width: 30 },
      { key: "currency", header: "Moneda", type: "text", width: 8 },
      { key: "base", header: "Base retenida", type: "money", currencyKey: "currency" },
      { key: "amount", header: "Retenido", type: "money", currencyKey: "currency" },
      { key: "amountBase", header: "Retenido (moneda base)", type: "money", total: true },
      { key: "amountUsd", header: "Retenido USD", type: "money", usd: true, total: true }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `SELECT * FROM (
             SELECT to_char(po.order_date, 'YYYY-MM-DD') AS day, 'Practicada' AS kind, po.number AS document,
                    COALESCE(s.trade_name, s.legal_name) AS party, s.rif AS "taxId", w ->> 'label' AS concept, TRIM(cur.code) AS currency,
                    (w ->> 'base')::float AS base, (w ->> 'amount')::float AS amount,
                    ((w ->> 'amount')::numeric * po.exchange_rate)::float AS "amountBase", fn_rate_on('USD', po.order_date)::float AS _usd
               FROM purchase_orders po
               JOIN suppliers s ON s.id = po.supplier_id
               JOIN catalogs_currencies cur ON cur.id = po.currency_id
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.taxes_detail -> 'withholdings', '[]'::jsonb)) w
              WHERE $3 AND po.status NOT IN ('draft', 'pending_approval', 'cancelled') AND po.order_date BETWEEN $1 AND $2
                AND (w ->> 'amount')::numeric > 0
             UNION ALL
             SELECT to_char(so.order_date, 'YYYY-MM-DD'), 'Sufrida', so.number, COALESCE(c.trade_name, c.legal_name), c.rif,
                    w ->> 'label', TRIM(cur.code), (w ->> 'base')::float, (w ->> 'amount')::float,
                    ((w ->> 'amount')::numeric * so.exchange_rate)::float, fn_rate_on('USD', so.order_date)::float
               FROM sales_orders so
               JOIN customers c ON c.id = so.customer_id
               JOIN catalogs_currencies cur ON cur.id = so.currency_id
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(so.taxes_detail -> 'withholdings', '[]'::jsonb)) w
              WHERE $4 AND so.status NOT IN ('draft', 'pending_approval', 'cancelled') AND so.order_date BETWEEN $1 AND $2
                AND (w ->> 'amount')::numeric > 0 AND ($5::uuid IS NULL OR so.created_by = $5)
           ) x ORDER BY day, kind, document`,
          [from, to, canView(access, "PUR_ORDERS"), canView(access, "SAL_ORDERS"), ownerScopeOf(access, "SAL_ORDERS", userId)]
        )
      ).map((r) => ({ ...r, amountUsd: usdOf(Number(r.amountBase), r._usd) })),
    kpis: [
      {
        key: "made",
        label: "Retenciones practicadas",
        type: "money",
        value: (r) => sum(r.filter((x) => x.kind === "Practicada"), "amountBase"),
        usd: (r) => sumUsd(r.filter((x) => x.kind === "Practicada"), "amountBase"),
        help: "A enterar al fisco por cuenta de los proveedores"
      },
      {
        key: "suffered",
        label: "Retenciones sufridas",
        type: "money",
        value: (r) => sum(r.filter((x) => x.kind === "Sufrida"), "amountBase"),
        usd: (r) => sumUsd(r.filter((x) => x.kind === "Sufrida"), "amountBase"),
        help: "Las que los clientes descuentan del cobro; se acreditan en la declaración"
      },
      { key: "documents", label: "Documentos", type: "int", value: (r) => new Set(r.map((x) => `${x.kind}:${x.document}`)).size }
    ],
    charts: [
      {
        title: "Retenido por concepto",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "amountBase", label: "Retenido (moneda base)" }],
        data: (rows) => groupSum(rows, (r) => `${r.kind} · ${r.concept}`, ["amountBase"], { sortBy: "amountBase" })
      }
    ]
  },
  {
    code: "EINVOICES",
    name: "Comprobantes electrónicos",
    description: "Facturas, tiquetes y notas de crédito electrónicas del rango con su estado ante Hacienda: aceptados, rechazados con su motivo y pendientes.",
    group: "Fiscal y tesorería",
    countries: ["CR"],
    module: "POS_SALES",
    ranged: true,
    columns: [
      { key: "issuedAt", header: "Emisión", type: "datetime" },
      { key: "docType", header: "Tipo", type: "text", width: 20 },
      { key: "consecutive", header: "Consecutivo", type: "text", width: 22 },
      { key: "ticket", header: "Ticket", type: "text", width: 16 },
      { key: "status", header: "Estado", type: "text", width: 11 },
      { key: "situation", header: "Situación", type: "text", width: 13 },
      { key: "total", header: "Total", type: "money", total: true },
      { key: "attempts", header: "Intentos", type: "int" },
      { key: "message", header: "Mensaje de Hacienda / error", type: "text", width: 50 },
      { key: "clave", header: "Clave", type: "text", width: 52 }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(COALESCE(e.issued_at, e.created_at), 'YYYY-MM-DD HH24:MI') AS "issuedAt", e.doc_type AS _type,
                  e.consecutive, s.ticket_number AS ticket, e.status AS _status, e.situation AS _situation,
                  (CASE WHEN e.doc_type = 'NC' THEN -1 ELSE 1 END * e.total)::float AS total, e.attempts,
                  COALESCE(e.response_message, e.last_error, e.reason) AS message, e.clave,
                  fn_rate_on('USD', COALESCE(e.issued_at, e.created_at)::date)::float AS _usd
             FROM einvoice_documents e LEFT JOIN pos_sales s ON s.id = e.sale_id
            WHERE COALESCE(e.issued_at, e.created_at)::date BETWEEN $1 AND $2
            ORDER BY COALESCE(e.issued_at, e.created_at), e.consecutive`,
          [from, to]
        )
      ).map((r) => ({
        ...r,
        docType: EINV_TYPE[String(r._type)] ?? r._type,
        status: EINV_STATUS[String(r._status)] ?? r._status,
        situation: EINV_SITUATION[String(r._situation)] ?? r._situation
      })),
    kpis: [
      { key: "documents", label: "Comprobantes", type: "int", value: (r) => r.length },
      { key: "accepted", label: "Aceptados", type: "pct", value: (r) => ratio(r.filter((x) => x._status === "accepted").length, r.length), better: "up" },
      { key: "rejected", label: "Rechazados", type: "int", value: (r) => r.filter((x) => x._status === "rejected").length, better: "down" },
      { key: "pending", label: "Sin respuesta", type: "int", value: (r) => r.filter((x) => x._status === "pending" || x._status === "sent").length, better: "down", help: "Pendientes de envío o enviados sin respuesta de Hacienda" },
      { key: "total", label: "Total facturado", type: "money", value: (r) => sum(r.filter((x) => x._status !== "cancelled"), "total"), usd: (r) => sumUsd(r.filter((x) => x._status !== "cancelled"), "total") }
    ],
    charts: [
      {
        title: "Comprobantes por estado",
        kind: "donut",
        type: "int",
        series: [{ key: "n", label: "Comprobantes" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, n: 1 })), "status", ["n"], { sortBy: "n" })
      }
    ]
  },
  {
    code: "FISCAL_DOCS",
    name: "Documentos fiscales",
    description: "Facturas y notas de crédito de la impresora fiscal o de la imprenta digital: número, control, estado, contingencias y errores pendientes.",
    group: "Fiscal y tesorería",
    countries: ["VE"],
    module: "POS_SALES",
    ranged: true,
    columns: [
      { key: "createdAt", header: "Fecha", type: "datetime" },
      { key: "docType", header: "Tipo", type: "text", width: 15 },
      { key: "issuer", header: "Emisor", type: "text", width: 17 },
      { key: "ticket", header: "Ticket", type: "text", width: 16 },
      { key: "documentNumber", header: "N.º documento", type: "text", width: 16 },
      { key: "controlNumber", header: "N.º de control", type: "text", width: 16 },
      { key: "machineSerial", header: "Serial", type: "text", width: 14 },
      { key: "zNumber", header: "Z", type: "int" },
      { key: "status", header: "Estado", type: "text", width: 13 },
      { key: "total", header: "Total", type: "money", total: true },
      { key: "igtf", header: "IGTF", type: "money", total: true },
      { key: "attempts", header: "Intentos", type: "int" },
      { key: "lastError", header: "Último error", type: "text", width: 44 }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(f.created_at, 'YYYY-MM-DD HH24:MI') AS "createdAt", f.doc_type AS _type, f.issuer AS _issuer, s.ticket_number AS ticket,
                  f.document_number AS "documentNumber", f.control_number AS "controlNumber", f.machine_serial AS "machineSerial",
                  f.z_number AS "zNumber", f.status AS _status, (CASE WHEN f.doc_type = 'NC' THEN -1 ELSE 1 END * f.total)::float AS total,
                  (CASE WHEN f.doc_type = 'NC' THEN -1 ELSE 1 END * COALESCE(f.igtf_amount, 0))::float AS igtf,
                  f.attempts, f.last_error AS "lastError", fn_rate_on('USD', f.created_at::date)::float AS _usd
             FROM fiscal_documents f LEFT JOIN pos_sales s ON s.id = f.sale_id
            WHERE f.created_at::date BETWEEN $1 AND $2
            ORDER BY f.created_at`,
          [from, to]
        )
      ).map((r) => ({
        ...r,
        docType: r._type === "NC" ? "Nota de crédito" : "Factura",
        issuer: r._issuer === "printer" ? "Impresora fiscal" : "Imprenta digital",
        status: FISCAL_STATUS[String(r._status)] ?? r._status
      })),
    kpis: [
      { key: "issued", label: "Emitidos", type: "int", value: (r) => r.filter((x) => x._status === "issued").length },
      { key: "pending", label: "Pendientes", type: "int", value: (r) => r.filter((x) => x._status === "pending").length, better: "down" },
      { key: "contingency", label: "En contingencia", type: "int", value: (r) => r.filter((x) => x._status === "contingency").length, better: "down", help: "Emitidos en formato manual por falla del emisor" },
      { key: "total", label: "Total neto", type: "money", value: (r) => sum(r.filter((x) => x._status !== "cancelled"), "total"), usd: (r) => sumUsd(r.filter((x) => x._status !== "cancelled"), "total") }
    ],
    charts: [
      {
        title: "Documentos por estado",
        kind: "donut",
        type: "int",
        series: [{ key: "n", label: "Documentos" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, n: 1 })), "status", ["n"], { sortBy: "n" })
      }
    ]
  },
  {
    code: "Z_REPORTS",
    name: "Reportes Z",
    description: "Cierres diarios de cada impresora fiscal: rango de facturas, cantidades y totales de ventas, exento, impuesto, notas de crédito e IGTF.",
    group: "Fiscal y tesorería",
    countries: ["VE"],
    module: "POS_SALES",
    ranged: true,
    columns: [
      { key: "reportDate", header: "Fecha", type: "date" },
      { key: "terminal", header: "Caja", type: "text", width: 14 },
      { key: "machineSerial", header: "Serial", type: "text", width: 14 },
      { key: "zNumber", header: "Z", type: "int" },
      { key: "firstInvoice", header: "Primera factura", type: "text", width: 14 },
      { key: "lastInvoice", header: "Última factura", type: "text", width: 14 },
      { key: "invoices", header: "Facturas", type: "int", total: true },
      { key: "creditNotes", header: "Notas de crédito", type: "int", total: true },
      { key: "sales", header: "Ventas", type: "money", total: true },
      { key: "exempt", header: "Exento", type: "money", total: true },
      { key: "tax", header: "Impuesto", type: "money", total: true },
      { key: "creditTotal", header: "Notas de crédito (monto)", type: "money", total: true },
      { key: "igtf", header: "IGTF", type: "money", total: true }
    ],
    rows: async ({ from, to }) =>
      query<Row>(
        `SELECT to_char(z.report_date, 'YYYY-MM-DD') AS "reportDate", t.code AS terminal, z.machine_serial AS "machineSerial", z.z_number AS "zNumber",
                z.first_invoice AS "firstInvoice", z.last_invoice AS "lastInvoice", z.invoices_count AS invoices, z.credit_notes_count AS "creditNotes",
                (z.totals ->> 'sales')::float AS sales, (z.totals ->> 'exempt')::float AS exempt,
                (SELECT SUM((x ->> 'amount')::numeric) FROM jsonb_array_elements(COALESCE(z.totals -> 'taxes', '[]'::jsonb)) x)::float AS tax,
                (z.totals ->> 'creditNotes')::float AS "creditTotal", (z.totals ->> 'igtf')::float AS igtf,
                fn_rate_on('USD', z.report_date)::float AS _usd
           FROM fiscal_z_reports z LEFT JOIN pos_terminals t ON t.id = z.terminal_id
          WHERE z.report_date BETWEEN $1 AND $2
          ORDER BY z.report_date, t.code, z.z_number`,
        [from, to]
      ),
    kpis: [
      { key: "reports", label: "Reportes Z", type: "int", value: (r) => r.length },
      { key: "invoices", label: "Facturas", type: "int", value: (r) => sum(r, "invoices") },
      { key: "sales", label: "Ventas", type: "money", value: (r) => sum(r, "sales"), usd: (r) => sumUsd(r, "sales") },
      { key: "tax", label: "Impuesto", type: "money", value: (r) => sum(r, "tax"), usd: (r) => sumUsd(r, "tax") }
    ],
    charts: [
      {
        title: "Ventas por día",
        kind: "bar",
        type: "money",
        series: [{ key: "sales", label: "Ventas" }],
        data: (rows) => groupSum(rows, (r) => ddmm(r.reportDate), ["sales"])
      }
    ]
  },
  {
    code: "FX_DIFFERENTIAL",
    name: "Diferencial cambiario de las ventas",
    description: "Venta de cada día a la tasa de ese día contra lo que vale hoy a la tasa actual: cuánto poder de compra se perdió (o ganó) por no convertir a tiempo.",
    group: "Fiscal y tesorería",
    module: SALES_MODULES,
    foreignBaseOnly: true,
    ranged: true,
    defaultDays: 31,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "rate", header: "Tasa del día", type: "qty" },
      { key: "netUsd", header: "Equivalente USD", type: "money", usd: true, total: true },
      { key: "todayRate", header: "Tasa de hoy", type: "qty" },
      { key: "today", header: "Valor a la tasa de hoy", type: "money", total: true },
      { key: "differential", header: "Diferencial", type: "money", total: true },
      { key: "differentialPct", header: "Diferencial %", type: "pct" }
    ],
    rows: async (ctx) => {
      const [lines, now] = await Promise.all([
        salesLines(ctx, ctx.from, ctx.to),
        query<{ rate: number | null }>(`SELECT fn_rate_on('USD', CURRENT_DATE)::float AS rate`)
      ]);
      const todayRate = now[0]?.rate ?? null;
      return eachDay(ctx.from, ctx.to)
        .map((day) => {
          const ls = lines.filter((l) => l.day === day);
          const net = ls.reduce((s, l) => s + l.net, 0);
          const rate = ls.find((l) => l.usd)?.usd ?? null;
          const usd = rate ? net / rate : null;
          const today = usd !== null && todayRate ? usd * todayRate : null;
          return {
            day,
            net,
            rate,
            netUsd: usd,
            todayRate,
            today,
            differential: today === null ? null : today - net,
            differentialPct: today === null ? null : ratio(today - net, net),
            _usd: rate
          };
        })
        .filter((r) => r.net !== 0);
    },
    kpis: [
      { key: "net", label: "Venta a la tasa de cada día", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net") },
      { key: "today", label: "Valor a la tasa de hoy", type: "money", value: (r) => sum(r, "today") },
      {
        key: "differential",
        label: "Diferencial",
        type: "money",
        value: (r) => sum(r, "differential"),
        help: "Positivo: la moneda base se devaluó y esas ventas, cobradas en moneda base, hoy compran menos dólares"
      },
      { key: "pct", label: "Diferencial %", type: "pct", value: (r) => ratio(sum(r, "differential"), sum(r, "net")) }
    ],
    charts: [
      {
        title: "Venta a la tasa del día y a la de hoy",
        kind: "line",
        type: "money",
        series: [
          { key: "net", label: "Tasa del día" },
          { key: "today", label: "Tasa de hoy" }
        ],
        data: (rows) => rows.map((r) => ({ label: ddmm(r.day), net: Math.round(Number(r.net) * 100) / 100, today: Math.round(Number(r.today ?? 0) * 100) / 100 }))
      }
    ]
  }
];
