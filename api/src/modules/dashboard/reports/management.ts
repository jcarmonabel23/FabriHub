/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/management.ts
 * @description Reportes gerenciales: resumen de la empresa en una página y ventas por empresa
 *
 * @overview
 * El resumen junta los números clave de cada área que el usuario puede ver (ventas, caja, compras,
 * producción, calidad, inventario) y los compara con el período anterior y con el mismo período del
 * año pasado. Ventas por empresa recorre las empresas del usuario, cada una con SU contexto (RLS) y
 * sus permisos, y las compara en dólares, porque cada una puede llevar su propia moneda base.
 */

import { one, query, runInCompany } from "../../../db.js";
import { canView, moduleAccess, ownerScopeOf, warehouseScopeOf } from "../access.js";
import { SALES_MODULES, salesLines } from "./sales.js";
import { type Ctx, type ReportDef, type Row, groupSum, pctChange, previousRange, ratio, sum } from "./types.js";

/** Misma fecha un año antes (el 29 de febrero pasa al 28) */
const yearAgo = (iso: string) => {
  const y = Number(iso.slice(0, 4)) - 1;
  const md = iso.slice(5) === "02-29" ? "02-28" : iso.slice(5);
  return `${y}-${md}`;
};

type Unit = "money" | "usd" | "int" | "pct";
interface Metric {
  key: string;
  area: string;
  indicator: string;
  unit: Unit;
  better: "up" | "down" | null;
  /** Solo foto de hoy: no se compara */
  snapshot?: boolean;
}
type Range = { from: string; to: string };

const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

async function salesMetrics(ctx: Ctx, r: Range) {
  const lines = await salesLines(ctx, r.from, r.to);
  const net = lines.reduce((s, l) => s + l.net, 0);
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  const docs = new Set(lines.map((l) => `${l.channel}:${l.docId}`)).size;
  return {
    net,
    netUsd: lines.some((l) => l.usd) ? lines.reduce((s, l) => s + (l.usd ? l.net / l.usd : 0), 0) : null,
    documents: docs,
    avgTicket: ratio(net, docs),
    marginPct: ratio(net - cost, net),
    discount: lines.reduce((s, l) => s + (l.gross - l.net), 0)
  };
}

async function areaMetrics(ctx: Ctx, r: Range): Promise<Record<string, number | null>> {
  const { access, userId } = ctx;
  const out: Record<string, number | null> = {};
  const jobs: Promise<void>[] = [];
  if (SALES_MODULES.some((m) => canView(access, m))) jobs.push(salesMetrics(ctx, r).then((s) => void Object.assign(out, s)));
  if (canView(access, "POS_SESSIONS")) {
    jobs.push(
      one<{ v: number | null }>(
        `SELECT SUM(COALESCE(c.difference, 0) * c.exchange_rate)::float AS v
           FROM pos_sessions s JOIN pos_sessions_counts c ON c.session_id = s.id
          WHERE s.status = 'closed' AND s.closed_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.cashier_id = $3)`,
        [r.from, r.to, ownerScopeOf(access, "POS_SESSIONS", userId)]
      ).then((x) => void (out.cashDiff = x?.v ?? 0))
    );
  }
  if (canView(access, "PUR_ORDERS")) {
    jobs.push(
      one<{ v: number | null }>(
        `SELECT SUM(po.taxable_amount * po.exchange_rate)::float AS v FROM purchase_orders po
          WHERE po.status IN ('approved', 'partially_received', 'received', 'closed') AND po.order_date BETWEEN $1 AND $2`,
        [r.from, r.to]
      ).then((x) => void (out.purchases = x?.v ?? 0))
    );
  }
  if (canView(access, "PRD_ORDERS")) {
    jobs.push(
      one<{ n: number; std: number | null; real: number | null }>(
        `SELECT COUNT(*)::int AS n,
                SUM((o.std_material_cost + o.std_labor_cost + o.std_overhead_cost) * o.quantity_produced / NULLIF(o.quantity_planned, 0))::float AS std,
                SUM(o.real_material_cost + o.real_labor_cost + o.real_overhead_cost)::float AS real
           FROM production_orders o WHERE o.status IN ('confirmed', 'closed') AND o.confirmed_at::date BETWEEN $1 AND $2`,
        [r.from, r.to]
      ).then((x) => {
        out.productionOrders = x?.n ?? 0;
        out.costVariance = x?.std ? ratio(Number(x.real) - x.std, x.std) : null;
      })
    );
  }
  if (canView(access, "QC_LOTS")) {
    jobs.push(
      one<{ n: number; rejected: number }>(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE e.to_status = 'rejected')::int AS rejected
           FROM lots_quality_events e WHERE e.to_status IN ('approved', 'rejected') AND e.decided_at::date BETWEEN $1 AND $2`,
        [r.from, r.to]
      ).then((x) => void (out.rejectedPct = x?.n ? ratio(x.rejected, x.n) : null))
    );
  }
  await Promise.all(jobs);
  return out;
}

/** Foto de hoy del inventario: valor y productos bajo su mínimo */
async function inventoryNow(ctx: Ctx): Promise<Record<string, number | null>> {
  if (!canView(ctx.access, "INV_STOCK")) return {};
  const x = await one<{ value: number | null; below: number }>(
    `SELECT (SELECT SUM(v.total_value) FROM stock_valuation v WHERE $1::uuid[] IS NULL OR v.warehouse_id = ANY($1))::float AS value,
            (SELECT COUNT(*) FROM stock_policies sp
              WHERE sp.min_qty > 0 AND ($1::uuid[] IS NULL OR sp.warehouse_id = ANY($1))
                AND COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.warehouse_id = sp.warehouse_id AND b.product_id = sp.product_id), 0) < sp.min_qty)::int AS below`,
    [warehouseScopeOf(ctx.access, "INV_STOCK")]
  );
  return { inventory: x?.value ?? 0, belowMin: x?.below ?? 0 };
}

const METRICS: Metric[] = [
  { key: "net", area: "Ventas", indicator: "Venta neta", unit: "money", better: "up" },
  { key: "netUsd", area: "Ventas", indicator: "Venta neta en dólares", unit: "usd", better: "up" },
  { key: "documents", area: "Ventas", indicator: "Documentos de venta", unit: "int", better: "up" },
  { key: "avgTicket", area: "Ventas", indicator: "Ticket promedio", unit: "money", better: "up" },
  { key: "marginPct", area: "Ventas", indicator: "Margen bruto", unit: "pct", better: "up" },
  { key: "discount", area: "Ventas", indicator: "Descuentos otorgados", unit: "money", better: "down" },
  { key: "cashDiff", area: "Caja", indicator: "Diferencia neta de los arqueos", unit: "money", better: null },
  { key: "purchases", area: "Compras", indicator: "Compras emitidas", unit: "money", better: null },
  { key: "productionOrders", area: "Producción", indicator: "OP terminadas", unit: "int", better: "up" },
  { key: "costVariance", area: "Producción", indicator: "Desvío del costo real contra el estándar", unit: "pct", better: "down" },
  { key: "rejectedPct", area: "Calidad", indicator: "Lotes rechazados", unit: "pct", better: "down" },
  { key: "inventory", area: "Inventario", indicator: "Valor del inventario (hoy)", unit: "money", better: null, snapshot: true },
  { key: "belowMin", area: "Inventario", indicator: "Productos bajo su mínimo (hoy)", unit: "int", better: "down", snapshot: true }
];

/** Valor tal como va en la fila: porcentajes en puntos (12,5), montos con 2 decimales */
const shown = (unit: Unit, v: number | null | undefined) => (v === null || v === undefined ? null : unit === "pct" ? Math.round(v * 1000) / 10 : r2(v));

function trend(m: Metric, now: number | null, before: number | null): string | null {
  if (m.snapshot || now === null || before === null) return null;
  if (Math.abs(now - before) < 1e-9) return "Igual";
  if (!m.better) return now > before ? "Sube" : "Baja";
  return (now > before) === (m.better === "up") ? "Mejora" : "Empeora";
}

const rowValue = (rows: Row[], key: string) => {
  const r = rows.find((x) => x._key === key);
  return r ? (r.value as number | null) : null;
};

export const MANAGEMENT_REPORTS: ReportDef[] = [
  {
    code: "MANAGEMENT_SUMMARY",
    name: "Resumen gerencial",
    description: "Una página con lo esencial de ventas, caja, compras, producción, calidad e inventario, contra el período anterior y el mismo período del año pasado.",
    group: "Gerencial",
    module: [...SALES_MODULES, "POS_SESSIONS", "PUR_ORDERS", "PRD_ORDERS", "QC_LOTS", "INV_STOCK"],
    ranged: true,
    compare: false,
    columns: [
      { key: "area", header: "Área", type: "text", width: 13 },
      { key: "indicator", header: "Indicador", type: "text", width: 40 },
      { key: "unit", header: "Unidad", type: "text", width: 8 },
      { key: "value", header: "Período", type: "qty" },
      { key: "previous", header: "Período anterior", type: "qty" },
      { key: "change", header: "Variación", type: "pct" },
      { key: "lastYear", header: "Mismo período año anterior", type: "qty" },
      { key: "changeYear", header: "Variación anual", type: "pct" },
      { key: "trend", header: "Tendencia", type: "text", width: 10 }
    ],
    rows: async (ctx) => {
      const prev = previousRange(ctx.from, ctx.to);
      const ly = { from: yearAgo(ctx.from), to: yearAgo(ctx.to) };
      const [now, before, last, inv] = await Promise.all([areaMetrics(ctx, ctx), areaMetrics(ctx, prev), areaMetrics(ctx, ly), inventoryNow(ctx)]);
      Object.assign(now, inv);
      return METRICS.filter((m) => m.key in now && !(m.unit === "usd" && ctx.base === "USD")).map((m) => {
        const v = now[m.key] ?? null;
        const p = m.snapshot ? null : (before[m.key] ?? null);
        const y = m.snapshot ? null : (last[m.key] ?? null);
        return {
          area: m.area,
          indicator: m.indicator,
          unit: m.unit === "money" ? ctx.base : m.unit === "usd" ? "USD" : m.unit === "pct" ? "%" : "cant.",
          value: shown(m.unit, v),
          previous: shown(m.unit, p),
          change: m.unit === "pct" || v === null || p === null ? null : pctChange(v, p),
          lastYear: shown(m.unit, y),
          changeYear: m.unit === "pct" || v === null || y === null ? null : pctChange(v, y),
          trend: trend(m, v, p),
          _key: m.key
        };
      });
    },
    kpis: [
      {
        key: "net",
        label: "Venta neta",
        type: "money",
        value: (r) => rowValue(r, "net"),
        usd: (r) => rowValue(r, "netUsd")
      },
      { key: "marginPct", label: "Margen bruto", type: "pct", value: (r) => (rowValue(r, "marginPct") === null ? null : Number(rowValue(r, "marginPct")) / 100) },
      { key: "purchases", label: "Compras", type: "money", value: (r) => rowValue(r, "purchases") },
      { key: "inventory", label: "Inventario hoy", type: "money", value: (r) => rowValue(r, "inventory") },
      {
        key: "better",
        label: "Indicadores que mejoran",
        type: "text",
        value: (r) => {
          const judged = r.filter((x) => x.trend === "Mejora" || x.trend === "Empeora");
          return judged.length ? `${judged.filter((x) => x.trend === "Mejora").length} de ${judged.length}` : null;
        },
        help: "Contra el período anterior, entre los indicadores con una dirección buena definida"
      }
    ],
    charts: [
      {
        title: "Venta neta: período, anterior y año pasado",
        kind: "bar",
        type: "money",
        series: [{ key: "value", label: "Venta neta" }],
        data: (rows) => {
          const r = rows.find((x) => x._key === "net");
          if (!r) return [];
          return [
            { label: "Año pasado", value: Number(r.lastYear ?? 0) },
            { label: "Período anterior", value: Number(r.previous ?? 0) },
            { label: "Período", value: Number(r.value ?? 0) }
          ];
        }
      }
    ]
  },
  {
    code: "COMPANIES_SALES",
    name: "Ventas por empresa",
    description: "Venta neta de cada empresa a la que usted tiene acceso, en su moneda y en dólares para compararlas, con la variación contra el período anterior.",
    group: "Gerencial",
    module: SALES_MODULES,
    ranged: true,
    compare: false,
    columns: [
      { key: "company", header: "Empresa", type: "text", width: 32 },
      { key: "country", header: "País", type: "text", width: 6 },
      { key: "currency", header: "Moneda", type: "text", width: 8 },
      { key: "documents", header: "Documentos", type: "int", total: true },
      { key: "net", header: "Venta neta", type: "money", currencyKey: "currency" },
      { key: "netUsd", header: "Venta neta en USD", type: "money", currency: "USD", total: true },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "share", header: "Participación", type: "pct" },
      { key: "prevUsd", header: "USD período anterior", type: "money", currency: "USD", total: true },
      { key: "change", header: "Variación en USD", type: "pct" }
    ],
    rows: async (ctx) => {
      const prev = previousRange(ctx.from, ctx.to);
      const companies = await query<{ id: string; name: string; country: string }>(
        `SELECT c.id, COALESCE(c.trade_name, c.legal_name) AS name, c.country_code AS country
           FROM users_companies uc JOIN companies c ON c.id = uc.company_id
          WHERE uc.user_id = $1 AND uc.is_active AND c.is_active ORDER BY name`,
        [ctx.userId]
      );
      const rows: Row[] = [];
      for (const c of companies) {
        const r = await runInCompany(c.id, async () => {
          const access = await moduleAccess(ctx.userId);
          if (!SALES_MODULES.some((m) => canView(access, m))) return null;
          const sub = { ...ctx, access };
          const [now, before, base] = await Promise.all([
            salesMetrics(sub, ctx),
            salesMetrics(sub, prev),
            one<{ code: string }>(`SELECT TRIM(cur.code) AS code FROM companies co JOIN catalogs_currencies cur ON cur.id = co.base_currency_id WHERE co.id = fn_current_company()`)
          ]);
          return { now, before, currency: base?.code ?? "" };
        });
        if (!r) continue;
        rows.push({
          company: c.name,
          country: c.country,
          currency: r.currency,
          documents: r.now.documents,
          net: r.now.net,
          netUsd: r.currency === "USD" ? r.now.net : r.now.netUsd,
          marginPct: r.now.marginPct,
          prevUsd: r.currency === "USD" ? r.before.net : r.before.netUsd
        });
      }
      const total = rows.reduce((s, r) => s + Number(r.netUsd ?? 0), 0);
      return rows
        .map((r) => ({ ...r, share: ratio(Number(r.netUsd ?? 0), total), change: pctChange(Number(r.netUsd ?? 0), Number(r.prevUsd ?? 0)) }))
        .sort((a: Row, b: Row) => Number(b.netUsd ?? 0) - Number(a.netUsd ?? 0));
    },
    kpis: [
      { key: "companies", label: "Empresas", type: "int", value: (r) => r.length },
      { key: "usd", label: "Venta total en USD", type: "money", currency: "USD", value: (r) => sum(r, "netUsd") },
      { key: "change", label: "Variación en USD", type: "pct", value: (r) => pctChange(sum(r, "netUsd"), sum(r, "prevUsd")) },
      { key: "leader", label: "Empresa que más vende", type: "text", value: (r) => (Number(r[0]?.netUsd) > 0 ? String(r[0].company) : null) }
    ],
    charts: [
      {
        title: "Venta en USD por empresa",
        kind: "bar",
        type: "money",
        currency: "USD",
        horizontal: true,
        series: [
          { key: "netUsd", label: "Período" },
          { key: "prevUsd", label: "Período anterior" }
        ],
        data: (rows) => groupSum(rows, "company", ["netUsd", "prevUsd"], { sortBy: "netUsd" })
      }
    ]
  }
];
