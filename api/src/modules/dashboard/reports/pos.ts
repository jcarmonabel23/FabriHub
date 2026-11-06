/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/pos.ts
 * @description Reportes de la caja: arqueos y diferencias por turno, y cobros por medio de pago y moneda
 *
 * Sin view_all, cada usuario ve solo sus turnos (POS_SESSIONS) o sus ventas (POS_SALES), como en la
 * pantalla del punto de venta.
 */

import { query } from "../../../db.js";
import { ownerScopeOf } from "../access.js";
import { type ReportDef, type Row, distinct, groupSum, ratio, sum, sumUsd } from "./types.js";

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Punto de venta",
  mobile: "Pago móvil",
  transfer: "Transferencia",
  change: "Vuelto entregado"
};

const usdOf = (amount: number, rate: unknown) => (Number(rate) ? amount / Number(rate) : null);

export const POS_REPORTS: ReportDef[] = [
  {
    code: "CASH_COUNTS",
    name: "Arqueos y diferencias de caja",
    description: "Turnos cerrados en el rango: lo esperado contra lo contado por medio de pago y moneda, con faltantes y sobrantes por cajero.",
    group: "Caja",
    module: "POS_SESSIONS",
    ranged: true,
    columns: [
      { key: "closedAt", header: "Cierre", type: "datetime" },
      { key: "session", header: "Turno", type: "text", width: 14 },
      { key: "terminal", header: "Caja", type: "text", width: 12 },
      { key: "cashier", header: "Cajero", type: "text", width: 24 },
      { key: "method", header: "Medio de pago", type: "text", width: 16 },
      { key: "currency", header: "Moneda", type: "text", width: 8 },
      { key: "opening", header: "Fondo", type: "money", currencyKey: "currency" },
      { key: "expected", header: "Esperado", type: "money", currencyKey: "currency" },
      { key: "counted", header: "Contado", type: "money", currencyKey: "currency" },
      { key: "difference", header: "Diferencia", type: "money", currencyKey: "currency" },
      { key: "differenceBase", header: "Diferencia (moneda base)", type: "money", total: true },
      { key: "differenceUsd", header: "Diferencia USD", type: "money", usd: true, total: true }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(s.closed_at, 'YYYY-MM-DD HH24:MI') AS "closedAt", s.number AS session, t.code AS terminal, u.names AS cashier,
                  c.method, TRIM(cur.code) AS currency, c.opening_amount::float AS opening, c.expected_amount::float AS expected,
                  c.counted_amount::float AS counted, c.difference::float AS difference,
                  (COALESCE(c.difference, 0) * c.exchange_rate)::float AS "differenceBase",
                  fn_rate_on('USD', s.closed_at::date)::float AS _usd
             FROM pos_sessions s
             JOIN pos_sessions_counts c ON c.session_id = s.id
             JOIN pos_terminals t ON t.id = s.terminal_id
             JOIN users u ON u.id = s.cashier_id
             JOIN catalogs_currencies cur ON cur.id = c.currency_id
            WHERE s.status = 'closed' AND s.closed_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.cashier_id = $3)
            ORDER BY s.closed_at, s.number, c.method, cur.code`,
          [from, to, ownerScopeOf(access, "POS_SESSIONS", userId)]
        )
      ).map((r) => ({ ...r, method: METHOD_LABEL[String(r.method)] ?? r.method, differenceUsd: usdOf(Number(r.differenceBase), r._usd) })),
    kpis: [
      { key: "sessions", label: "Turnos cerrados", type: "int", value: (r) => distinct(r, "session") },
      {
        key: "net",
        label: "Diferencia neta",
        type: "money",
        value: (r) => sum(r, "differenceBase"),
        usd: (r) => sumUsd(r, "differenceBase"),
        help: "Sobrantes menos faltantes, en moneda base con la tasa de cada conteo"
      },
      {
        key: "short",
        label: "Faltantes",
        type: "money",
        value: (r) => -sum(r.filter((x) => Number(x.differenceBase) < 0), "differenceBase"),
        usd: (r) => {
          const u = sumUsd(r.filter((x) => Number(x.differenceBase) < 0), "differenceBase");
          return u === null ? null : -u;
        },
        better: "down"
      },
      {
        key: "over",
        label: "Sobrantes",
        type: "money",
        value: (r) => sum(r.filter((x) => Number(x.differenceBase) > 0), "differenceBase"),
        usd: (r) => sumUsd(r.filter((x) => Number(x.differenceBase) > 0), "differenceBase"),
        better: "down"
      },
      {
        key: "withDiff",
        label: "Turnos con diferencia",
        type: "int",
        value: (r) => distinct(r.filter((x) => Math.abs(Number(x.differenceBase)) >= 0.01), "session"),
        better: "down"
      }
    ],
    charts: [
      {
        title: "Diferencia por cajero (moneda base)",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "differenceBase", label: "Diferencia" }],
        data: (rows) => groupSum(rows, "cashier", ["differenceBase"], { sortBy: "differenceBase", asc: true })
      }
    ]
  },
  {
    code: "PAYMENTS",
    name: "Cobros por medio de pago y moneda",
    description: "Lo cobrado en la caja cada día por medio de pago (efectivo, punto de venta, pago móvil, transferencia) y moneda, menos el vuelto entregado.",
    group: "Caja",
    module: "POS_SALES",
    ranged: true,
    defaultDays: 7,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "method", header: "Medio de pago", type: "text", width: 18 },
      { key: "currency", header: "Moneda", type: "text", width: 8 },
      { key: "count", header: "Operaciones", type: "int", total: true },
      { key: "amount", header: "Monto", type: "money", currencyKey: "currency" },
      { key: "amountBase", header: "Monto (moneda base)", type: "money", total: true },
      { key: "amountUsd", header: "Monto USD", type: "money", usd: true, total: true },
      { key: "share", header: "Participación", type: "pct" }
    ],
    rows: async ({ access, userId, from, to, base }) => {
      const rows = await query<Row>(
        `WITH p AS (
           SELECT s.sale_date AS day, pp.method, pp.currency_id, COUNT(*) AS n, SUM(pp.amount) AS amount, SUM(pp.amount_base) AS base
             FROM pos_sales s JOIN pos_sales_payments pp ON pp.sale_id = s.id
            WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.created_by = $3)
            GROUP BY 1, 2, 3
           UNION ALL
           SELECT s.sale_date, 'change', COALESCE(s.change_currency_id, s.currency_id), COUNT(*), -SUM(s.change_in_currency), -SUM(s.change_amount)
             FROM pos_sales s
            WHERE s.status = 'completed' AND s.change_amount > 0 AND s.sale_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.created_by = $3)
            GROUP BY 1, 3
         )
         SELECT to_char(p.day, 'YYYY-MM-DD') AS day, p.method AS _method, TRIM(c.code) AS currency, p.n::int AS count,
                p.amount::float AS amount, p.base::float AS "amountBase", fn_rate_on('USD', p.day)::float AS _usd
           FROM p JOIN catalogs_currencies c ON c.id = p.currency_id
          ORDER BY p.day, p.method = 'change', p.method, c.code`,
        [from, to, ownerScopeOf(access, "POS_SALES", userId)]
      );
      const collected = rows.filter((r) => r._method !== "change").reduce((s, r) => s + Number(r.amountBase), 0);
      return rows.map((r) => ({
        ...r,
        method: METHOD_LABEL[String(r._method)] ?? r._method,
        amountUsd: usdOf(Number(r.amountBase), r._usd),
        share: r._method === "change" ? null : ratio(Number(r.amountBase), collected),
        _foreign: r.currency !== base
      }));
    },
    kpis: [
      {
        key: "collected",
        label: "Cobrado neto",
        type: "money",
        value: (r) => sum(r, "amountBase"),
        usd: (r) => sumUsd(r, "amountBase"),
        better: "up",
        help: "Pagos recibidos menos el vuelto entregado, en moneda base"
      },
      {
        key: "foreign",
        label: "En divisas",
        type: "pct",
        value: (r) => ratio(sum(r.filter((x) => x._foreign), "amountBase"), sum(r, "amountBase")),
        help: "Parte de lo cobrado (neto de vuelto) que entró en monedas distintas a la base"
      },
      {
        key: "cash",
        label: "En efectivo",
        type: "pct",
        value: (r) => ratio(sum(r.filter((x) => x._method === "cash" || x._method === "change"), "amountBase"), sum(r, "amountBase")),
        help: "Efectivo recibido menos vuelto, sobre lo cobrado neto"
      },
      {
        key: "change",
        label: "Vuelto entregado",
        type: "money",
        value: (r) => -sum(r.filter((x) => x._method === "change"), "amountBase"),
        usd: (r) => {
          const u = sumUsd(r.filter((x) => x._method === "change"), "amountBase");
          return u === null ? null : -u;
        }
      }
    ],
    charts: [
      {
        title: "Cobros por medio de pago",
        kind: "donut",
        type: "money",
        series: [{ key: "amountBase", label: "Monto (moneda base)" }],
        data: (rows) => groupSum(rows.filter((r) => r._method !== "change"), "method", ["amountBase"], { sortBy: "amountBase" })
      },
      {
        title: "Cobrado neto por moneda",
        kind: "donut",
        type: "money",
        series: [{ key: "amountBase", label: "Monto (moneda base)" }],
        data: (rows) => groupSum(rows, "currency", ["amountBase"], { sortBy: "amountBase" }).filter((p) => Number(p.amountBase) > 0)
      }
    ]
  }
];
