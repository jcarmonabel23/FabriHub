/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/salesAnalysis.ts
 * @description Reportes de análisis de ventas: por hora y día de la semana, por familia y categoría,
 * por cajero y caja, y descuentos con su autorización
 *
 * @overview
 * Hora y familia parten de salesLines (caja + pedidos, ver sales.ts). Cajeros y descuentos leen los
 * documentos completos porque necesitan lo que no está en las líneas: anulaciones, quién cobró y
 * quién autorizó el descuento. La hora es la local de la empresa (la conexión fija su zona horaria).
 */

import { query } from "../../../db.js";
import { canView, ownerScopeOf } from "../access.js";
import { SALES_MODULES, salesLines } from "./sales.js";
import { type ChartPoint, type ReportDef, type Row, WEEKDAY, distinct, groupSum, pctChange, previousRange, ratio, sum, sumUsd, usdOf } from "./types.js";

/** Lunes a domingo (WEEKDAY empieza en domingo) */
const WEEK = [1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAY[i]);
const SHORT = WEEK.map((d) => d.slice(0, 3));
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export const SALES_ANALYSIS_REPORTS: ReportDef[] = [
  {
    code: "SALES_HOURS",
    name: "Ventas por hora y día de la semana",
    description: "Venta neta y documentos por hora del día y día de la semana: cuándo reforzar la caja y cuándo conviene una promoción.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    defaultDays: 28,
    columns: [
      { key: "hour", header: "Hora", type: "text", width: 9 },
      ...SHORT.map((d) => ({ key: d, header: `Venta ${d}`, type: "money" as const, total: true })),
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "documents", header: "Documentos", type: "int", total: true },
      { key: "avgTicket", header: "Ticket promedio", type: "money" },
      { key: "share", header: "Participación", type: "pct" }
    ],
    rows: async (ctx) => {
      const lines = await salesLines(ctx, ctx.from, ctx.to);
      const total = lines.reduce((s, l) => s + l.net, 0);
      const hours = [...new Set(lines.map((l) => l.hour))].sort((a, b) => a - b);
      return hours.map((h) => {
        const ls = lines.filter((l) => l.hour === h);
        const net = ls.reduce((s, l) => s + l.net, 0);
        const usd = ls.reduce((s, l) => s + (l.usd ? l.net / l.usd : 0), 0);
        const docs = new Set(ls.map((l) => `${l.channel}:${l.docId}`)).size;
        const byDay = Object.fromEntries(
          SHORT.map((d, i) => [d, ls.filter((l) => WEEKDAY[new Date(`${l.day}T12:00:00Z`).getUTCDay()] === WEEK[i]).reduce((s, l) => s + l.net, 0)])
        );
        return {
          hour: hourLabel(h),
          ...byDay,
          net,
          netUsd: ls.some((l) => l.usd) ? usd : null,
          documents: docs,
          avgTicket: ratio(net, docs),
          share: ratio(net, total),
          _usd: usd ? net / usd : null
        };
      });
    },
    kpis: [
      { key: "net", label: "Venta neta", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net"), better: "up" },
      { key: "documents", label: "Documentos", type: "int", value: (r) => sum(r, "documents"), better: "up" },
      {
        key: "peakHour",
        label: "Hora pico",
        type: "text",
        value: (r) => (r.length ? String([...r].sort((a, b) => Number(b.net) - Number(a.net))[0].hour) : null),
        help: "La hora con más venta neta en el rango"
      },
      {
        key: "peakDay",
        label: "Día más fuerte",
        type: "text",
        value: (r) => {
          const totals = SHORT.map((d, i) => ({ d: WEEK[i], v: sum(r, d) })).sort((a, b) => b.v - a.v);
          return totals[0]?.v ? totals[0].d : null;
        }
      },
      {
        key: "top3",
        label: "Peso de las 3 mejores horas",
        type: "pct",
        value: (r) => ratio([...r].sort((a, b) => Number(b.net) - Number(a.net)).slice(0, 3).reduce((s, x) => s + Number(x.net), 0), sum(r, "net")),
        help: "Qué parte de la venta se concentra en las tres horas más fuertes"
      }
    ],
    charts: [
      {
        title: "Mapa de calor: venta neta por hora y día",
        kind: "heatmap",
        type: "money",
        series: SHORT.map((d) => ({ key: d, label: d })),
        data: (rows) => rows.map((r) => ({ label: String(r.hour), ...Object.fromEntries(SHORT.map((d) => [d, Math.round(Number(r[d]) * 100) / 100])) }))
      },
      {
        title: "Venta por día de la semana",
        kind: "bar",
        type: "money",
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => SHORT.map((d, i) => ({ label: WEEK[i], net: Math.round(sum(rows, d) * 100) / 100 }))
      },
      {
        title: "Documentos por hora",
        kind: "bar",
        type: "int",
        series: [{ key: "documents", label: "Documentos" }],
        data: (rows) => rows.map((r) => ({ label: String(r.hour), documents: Number(r.documents) }))
      }
    ]
  },
  {
    code: "SALES_FAMILY",
    name: "Ventas por familia y categoría",
    description: "Venta neta, margen y participación de cada familia y categoría de producto, con la variación contra el período anterior.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    compare: false,
    columns: [
      { key: "family", header: "Familia", type: "text", width: 24 },
      { key: "category", header: "Categoría", type: "text", width: 24 },
      { key: "products", header: "Productos vendidos", type: "int" },
      { key: "units", header: "Unidades (inv.)", type: "qty", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "share", header: "Participación", type: "pct" },
      { key: "margin", header: "Margen", type: "money", total: true },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "prevNet", header: "Venta período anterior", type: "money", total: true },
      { key: "change", header: "Variación", type: "pct" }
    ],
    rows: async (ctx) => {
      const prev = previousRange(ctx.from, ctx.to);
      const [now, before] = await Promise.all([salesLines(ctx, ctx.from, ctx.to), salesLines(ctx, prev.from, prev.to)]);
      const key = (l: { family: string | null; category: string | null }) => `${l.family ?? "Sin familia"}\u0000${l.category ?? "Sin categoría"}`;
      const total = now.reduce((s, l) => s + l.net, 0);
      const prevBy = new Map<string, number>();
      for (const l of before) prevBy.set(key(l), (prevBy.get(key(l)) ?? 0) + l.net);
      const groups = new Map<string, typeof now>();
      for (const l of now) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
      for (const k of prevBy.keys()) if (!groups.has(k)) groups.set(k, []);
      return [...groups.entries()]
        .map(([k, ls]) => {
          const [family, category] = k.split("\u0000");
          const net = ls.reduce((s, l) => s + l.net, 0);
          const cost = ls.reduce((s, l) => s + l.cost, 0);
          const usd = ls.reduce((s, l) => s + (l.usd ? l.net / l.usd : 0), 0);
          const prevNet = prevBy.get(k) ?? 0;
          return {
            family,
            category,
            products: new Set(ls.map((l) => l.productId)).size,
            units: ls.reduce((s, l) => s + l.qty, 0),
            net,
            netUsd: ls.some((l) => l.usd) ? usd : null,
            share: ratio(net, total),
            margin: net - cost,
            marginPct: ratio(net - cost, net),
            prevNet,
            change: pctChange(net, prevNet),
            _usd: usd ? net / usd : null
          };
        })
        .sort((a, b) => b.net - a.net || a.family.localeCompare(b.family));
    },
    kpis: [
      { key: "net", label: "Venta neta", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net") },
      { key: "change", label: "Variación total", type: "pct", value: (r) => pctChange(sum(r, "net"), sum(r, "prevNet")), help: "Contra el período anterior de igual duración" },
      { key: "growing", label: "Líneas que crecen", type: "int", value: (r) => r.filter((x) => Number(x.net) > Number(x.prevNet)).length },
      { key: "falling", label: "Líneas que caen", type: "int", value: (r) => r.filter((x) => Number(x.net) < Number(x.prevNet)).length },
      {
        key: "leader",
        label: "Familia líder",
        type: "text",
        value: (r) => groupSum(r, "family", ["net"], { sortBy: "net", top: 1 }).find((p) => Number(p.net) > 0)?.label ?? null
      }
    ],
    charts: [
      {
        title: "Venta neta por familia: período y anterior",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [
          { key: "net", label: "Período" },
          { key: "prevNet", label: "Período anterior" }
        ],
        data: (rows) => groupSum(rows, "family", ["net", "prevNet"], { sortBy: "net", top: 12 })
      },
      {
        title: "Participación por familia",
        kind: "donut",
        type: "money",
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => groupSum(rows, "family", ["net"], { sortBy: "net" })
      }
    ]
  },
  {
    code: "SALES_CASHIERS",
    name: "Ventas por cajero y caja",
    description: "Tickets, venta, ticket promedio, descuentos y anulaciones de cada cajero en cada caja.",
    group: "Caja",
    module: "POS_SALES",
    ranged: true,
    columns: [
      { key: "cashier", header: "Cajero", type: "text", width: 26 },
      { key: "terminal", header: "Caja", type: "text", width: 18 },
      { key: "sessions", header: "Turnos", type: "int", total: true },
      { key: "tickets", header: "Tickets", type: "int", total: true },
      { key: "items", header: "Unidades por ticket", type: "qty" },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "avgTicket", header: "Ticket promedio", type: "money" },
      { key: "discount", header: "Descuentos", type: "money", total: true },
      { key: "discountPct", header: "Descuento %", type: "pct" },
      { key: "voided", header: "Anulados", type: "int", total: true },
      { key: "voidedAmount", header: "Monto anulado", type: "money", total: true },
      { key: "voidedPct", header: "Anulados %", type: "pct" }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `WITH s AS (
             SELECT s.*, fn_rate_on('USD', s.sale_date) AS usd,
                    (SELECT SUM(d.quantity) FROM pos_sales_details d WHERE d.sale_id = s.id) AS units
               FROM pos_sales s
              WHERE s.sale_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.created_by = $3)
           )
           SELECT u.names AS cashier, t.code || ' · ' || t.name AS terminal, COUNT(DISTINCT s.session_id)::int AS sessions,
                  COUNT(*) FILTER (WHERE s.status = 'completed')::int AS tickets,
                  (SUM(s.units) FILTER (WHERE s.status = 'completed'))::float AS units,
                  COALESCE(SUM(s.taxable_amount) FILTER (WHERE s.status = 'completed'), 0)::float AS net,
                  (SUM(s.taxable_amount / NULLIF(s.usd, 0)) FILTER (WHERE s.status = 'completed'))::float AS "netUsd",
                  COALESCE(SUM(s.discount_amount) FILTER (WHERE s.status = 'completed'), 0)::float AS discount,
                  COALESCE(SUM(s.subtotal) FILTER (WHERE s.status = 'completed'), 0)::float AS gross,
                  COUNT(*) FILTER (WHERE s.status = 'voided')::int AS voided,
                  COALESCE(SUM(s.taxable_amount) FILTER (WHERE s.status = 'voided'), 0)::float AS "voidedAmount"
             FROM s JOIN users u ON u.id = s.created_by JOIN pos_terminals t ON t.id = s.terminal_id
            GROUP BY u.names, t.code, t.name
            ORDER BY net DESC`,
          [from, to, ownerScopeOf(access, "POS_SALES", userId)]
        )
      ).map((r) => {
        const tickets = Number(r.tickets);
        const net = Number(r.net);
        return {
          cashier: r.cashier,
          terminal: r.terminal,
          sessions: r.sessions,
          tickets,
          items: ratio(Number(r.units), tickets),
          net,
          netUsd: r.netUsd,
          avgTicket: ratio(net, tickets),
          discount: r.discount,
          discountPct: ratio(Number(r.discount), Number(r.gross)),
          voided: r.voided,
          voidedAmount: r.voidedAmount,
          voidedPct: ratio(Number(r.voided), tickets + Number(r.voided)),
          _usd: r.netUsd ? net / Number(r.netUsd) : null,
          _gross: r.gross
        };
      }),
    kpis: [
      { key: "cashiers", label: "Cajeros con ventas", type: "int", value: (r) => distinct(r.filter((x) => Number(x.tickets) > 0), "cashier") },
      { key: "tickets", label: "Tickets", type: "int", value: (r) => sum(r, "tickets"), better: "up" },
      {
        key: "avgTicket",
        label: "Ticket promedio",
        type: "money",
        value: (r) => ratio(sum(r, "net"), sum(r, "tickets")),
        usd: (r) => {
          const u = sumUsd(r, "net");
          return u === null ? null : ratio(u, sum(r, "tickets"));
        },
        better: "up"
      },
      { key: "discountPct", label: "Descuento sobre venta", type: "pct", value: (r) => ratio(sum(r, "discount"), sum(r, "_gross")), better: "down" },
      { key: "voided", label: "Tickets anulados", type: "int", value: (r) => sum(r, "voided"), better: "down" }
    ],
    charts: [
      {
        title: "Venta neta por cajero",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => groupSum(rows, "cashier", ["net"], { sortBy: "net", top: 15 })
      },
      {
        title: "Venta por caja",
        kind: "donut",
        type: "money",
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => groupSum(rows, "terminal", ["net"], { sortBy: "net" })
      }
    ]
  },
  {
    code: "DISCOUNTS",
    name: "Descuentos y autorizaciones",
    description: "Cada ticket u orden de venta con descuento: cuánto se descontó, quién lo dio y quién lo autorizó o aprobó.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "channel", header: "Canal", type: "text", width: 9 },
      { key: "document", header: "Documento", type: "text", width: 16 },
      { key: "customer", header: "Cliente", type: "text", width: 28 },
      { key: "givenBy", header: "Lo dio", type: "text", width: 24 },
      { key: "authorizedBy", header: "Autorizó / aprobó", type: "text", width: 24 },
      { key: "subtotal", header: "Subtotal", type: "money", total: true },
      { key: "discount", header: "Descuento", type: "money", total: true },
      { key: "discountUsd", header: "Descuento USD", type: "money", usd: true, total: true },
      { key: "discountPct", header: "Descuento %", type: "pct" },
      { key: "net", header: "Neto", type: "money", total: true }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `SELECT * FROM (
             SELECT to_char(s.sale_date, 'YYYY-MM-DD') AS day, 'Caja' AS channel, s.ticket_number AS document,
                    COALESCE(c.trade_name, c.legal_name) AS customer, u.names AS "givenBy", a.names AS "authorizedBy",
                    s.subtotal::float AS subtotal, s.discount_amount::float AS discount, s.taxable_amount::float AS net,
                    fn_rate_on('USD', s.sale_date)::float AS _usd
               FROM pos_sales s
               JOIN users u ON u.id = s.created_by
               LEFT JOIN users a ON a.id = s.discount_authorized_by
               LEFT JOIN customers c ON c.id = s.customer_id
              WHERE $3 AND s.status = 'completed' AND s.discount_amount > 0 AND s.sale_date BETWEEN $1 AND $2
                AND ($4::uuid IS NULL OR s.created_by = $4)
             UNION ALL
             SELECT to_char(so.order_date, 'YYYY-MM-DD'), 'Pedidos', so.number, COALESCE(c.trade_name, c.legal_name),
                    COALESCE(sl.name, u.names), a.names,
                    (so.subtotal * so.exchange_rate)::float, (so.discount_amount * so.exchange_rate)::float,
                    (so.taxable_amount * so.exchange_rate)::float, fn_rate_on('USD', so.order_date)::float
               FROM sales_orders so
               JOIN users u ON u.id = so.created_by
               JOIN customers c ON c.id = so.customer_id
               LEFT JOIN sellers sl ON sl.id = so.seller_id
               LEFT JOIN users a ON a.id = so.approved_by
              WHERE $5 AND so.status NOT IN ('draft', 'cancelled') AND so.discount_amount > 0 AND so.order_date BETWEEN $1 AND $2
                AND ($6::uuid IS NULL OR so.created_by = $6)
           ) x ORDER BY day, channel, document`,
          [
            from,
            to,
            canView(access, "POS_SALES"),
            ownerScopeOf(access, "POS_SALES", userId),
            canView(access, "SAL_ORDERS"),
            ownerScopeOf(access, "SAL_ORDERS", userId)
          ]
        )
      ).map((r) => ({
        ...r,
        authorizedBy: r.authorizedBy ?? "Sin autorización",
        discountUsd: usdOf(Number(r.discount), r._usd),
        discountPct: ratio(Number(r.discount), Number(r.subtotal))
      })),
    kpis: [
      { key: "discount", label: "Total descontado", type: "money", value: (r) => sum(r, "discount"), usd: (r) => sumUsd(r, "discount"), better: "down" },
      {
        key: "discountPct",
        label: "Descuento promedio",
        type: "pct",
        value: (r) => ratio(sum(r, "discount"), sum(r, "subtotal")),
        better: "down",
        help: "Descontado sobre el subtotal de los documentos con descuento"
      },
      { key: "documents", label: "Documentos con descuento", type: "int", value: (r) => r.length, better: "down" },
      {
        key: "unauthorized",
        label: "Sin autorización",
        type: "int",
        value: (r) => r.filter((x) => x.authorizedBy === "Sin autorización").length,
        help: "Descuentos dentro del tope del usuario, que no pidieron autorización"
      }
    ],
    charts: [
      {
        title: "Descuento por quien lo dio",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "discount", label: "Descuento" }],
        data: (rows) => groupSum(rows, "givenBy", ["discount"], { sortBy: "discount", top: 12 })
      },
      {
        title: "Descuento por quien lo autorizó",
        kind: "donut",
        type: "money",
        series: [{ key: "discount", label: "Descuento" }],
        data: (rows): ChartPoint[] => groupSum(rows, "authorizedBy", ["discount"], { sortBy: "discount" })
      }
    ]
  }
];
