/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/sales.ts
 * @description Reportes de ventas para el día a día: cierre diario, productos más y menos vendidos,
 * análisis ABC y margen por producto
 *
 * @overview
 * Todos parten de salesLines: las ventas de la caja (tickets completados) y las de pedidos (notas de
 * entrega contabilizadas), en moneda base y netas de descuentos, con su costo. Cada canal entra solo
 * si el usuario puede ver su módulo (Caja → POS_SALES, Pedidos → SAL_ORDERS) y con el mismo alcance
 * de esa pantalla (sin view_all, solo lo que él registró).
 */

import { query } from "../../../db.js";
import { canView, ownerScopeOf, warehouseScopeOf } from "../access.js";
import {
  type ChartPoint,
  type Ctx,
  type ReportDef,
  type Row,
  ddmm,
  eachDay,
  groupSum,
  pctChange,
  previousRange,
  ratio,
  sum,
  sumUsd,
  weekday
} from "./types.js";

export const SALES_MODULES = ["POS_SALES", "SAL_ORDERS"];

export interface SaleLine {
  day: string;
  channel: "Caja" | "Pedidos";
  /** Hora local (0-23) en que se registró el documento */
  hour: number;
  docId: string;
  productId: string;
  productCode: string;
  productName: string;
  family: string | null;
  category: string | null;
  customerId: string | null;
  customer: string | null;
  /** Cliente genérico de mostrador (el predeterminado de alguna caja) */
  counter: boolean;
  qty: number;
  gross: number;
  net: number;
  cost: number;
  /** Unidades de moneda base por dólar en esa fecha */
  usd: number | null;
}

/** Líneas vendidas en el rango por ambos canales, en moneda base */
export async function salesLines(ctx: Pick<Ctx, "access" | "userId">, from: string, to: string): Promise<SaleLine[]> {
  const { access, userId } = ctx;
  return query<SaleLine>(
    `WITH l AS (
       SELECT to_char(s.sale_date, 'YYYY-MM-DD') AS day, 'Caja' AS channel, extract(hour FROM s.created_at)::int AS hour, s.id AS "docId", s.customer_id, d.product_id,
              d.stock_quantity AS qty, d.quantity * d.unit_price AS gross, d.net_amount AS net,
              d.stock_quantity * COALESCE(d.unit_cost, 0) AS cost
         FROM pos_sales s JOIN pos_sales_details d ON d.sale_id = s.id
        WHERE $3 AND s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2 AND ($4::uuid IS NULL OR s.created_by = $4)
       UNION ALL
       SELECT to_char(n.delivery_date, 'YYYY-MM-DD'), 'Pedidos', extract(hour FROM n.created_at)::int, n.id, so.customer_id, d.product_id, d.stock_quantity,
              d.quantity * d.unit_price * so.exchange_rate,
              d.quantity * COALESCE(sod.net_amount / NULLIF(sod.quantity, 0), d.unit_price) * so.exchange_rate,
              d.stock_quantity * COALESCE(d.unit_cost, 0)
         FROM delivery_notes_details d
         JOIN delivery_notes n ON n.id = d.delivery_note_id
         JOIN sales_orders so ON so.id = n.sales_order_id
         LEFT JOIN sales_orders_details sod ON sod.id = d.so_line_id
        WHERE $5 AND n.status = 'posted' AND n.delivery_date BETWEEN $1 AND $2 AND ($6::uuid IS NULL OR so.created_by = $6)
     ), r AS (SELECT day, fn_rate_on('USD', day::date) AS usd FROM (SELECT DISTINCT day FROM l) x)
     SELECT l.day, l.channel, l.hour, l."docId", l.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
            f.name AS family, cat.name AS category, l.customer_id AS "customerId", COALESCE(c.trade_name, c.legal_name) AS customer,
            EXISTS (SELECT 1 FROM pos_terminals t WHERE t.default_customer_id = l.customer_id) AS counter,
            l.qty::float AS qty, l.gross::float AS gross, l.net::float AS net, l.cost::float AS cost, r.usd::float AS usd
       FROM l JOIN r ON r.day = l.day
       JOIN products p ON p.id = l.product_id
       LEFT JOIN catalogs_product_families f ON f.id = p.family_id
       LEFT JOIN catalogs_product_categories cat ON cat.id = p.category_id
       LEFT JOIN customers c ON c.id = l.customer_id`,
    [
      from,
      to,
      canView(access, "POS_SALES"),
      ownerScopeOf(access, "POS_SALES", userId),
      canView(access, "SAL_ORDERS"),
      ownerScopeOf(access, "SAL_ORDERS", userId)
    ]
  );
}

interface ProductAgg {
  productId: string;
  productCode: string;
  productName: string;
  family: string | null;
  units: number;
  net: number;
  netUsd: number;
  cost: number;
  hasUsd: boolean;
}

export function byProduct(lines: SaleLine[]): Map<string, ProductAgg> {
  const m = new Map<string, ProductAgg>();
  for (const l of lines) {
    const a = m.get(l.productId) ?? {
      productId: l.productId,
      productCode: l.productCode,
      productName: l.productName,
      family: l.family,
      units: 0,
      net: 0,
      netUsd: 0,
      cost: 0,
      hasUsd: false
    };
    a.units += l.qty;
    a.net += l.net;
    a.cost += l.cost;
    if (l.usd) {
      a.netUsd += l.net / l.usd;
      a.hasUsd = true;
    }
    m.set(l.productId, a);
  }
  return m;
}

/** `_usd` de una fila agregada: la tasa implícita (base / USD) para que sumUsd la respete */
export const impliedRate = (net: number, netUsd: number, hasUsd: boolean) => (hasUsd && netUsd ? net / netUsd : null);

// ------------------------------------------------------------------ Reportes

export const SALES_REPORTS: ReportDef[] = [
  {
    code: "SALES_DAILY",
    name: "Cierre de ventas por día",
    description: "Venta neta, documentos, ticket promedio, descuentos y margen de cada día, de la caja y de pedidos, comparados con el período anterior.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    defaultDays: 7,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "weekday", header: "Día", type: "text", width: 11 },
      { key: "documents", header: "Documentos", type: "int", total: true },
      { key: "units", header: "Unidades (inv.)", type: "qty", total: true },
      { key: "posNet", header: "Venta caja", type: "money", total: true },
      { key: "soNet", header: "Venta pedidos", type: "money", total: true },
      { key: "discount", header: "Descuentos", type: "money", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "cost", header: "Costo", type: "money", total: true },
      { key: "margin", header: "Margen", type: "money", total: true },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "avgTicket", header: "Ticket promedio", type: "money" }
    ],
    rows: async (ctx) => {
      const lines = await salesLines(ctx, ctx.from, ctx.to);
      return eachDay(ctx.from, ctx.to).map((day) => {
        const ls = lines.filter((l) => l.day === day);
        const net = ls.reduce((s, l) => s + l.net, 0);
        const cost = ls.reduce((s, l) => s + l.cost, 0);
        const docs = new Set(ls.map((l) => `${l.channel}:${l.docId}`)).size;
        const rate = ls.find((l) => l.usd)?.usd ?? null;
        return {
          day,
          weekday: weekday(day),
          documents: docs,
          units: ls.reduce((s, l) => s + l.qty, 0),
          posNet: ls.filter((l) => l.channel === "Caja").reduce((s, l) => s + l.net, 0),
          soNet: ls.filter((l) => l.channel === "Pedidos").reduce((s, l) => s + l.net, 0),
          discount: ls.reduce((s, l) => s + (l.gross - l.net), 0),
          net,
          netUsd: rate ? net / rate : null,
          cost,
          margin: net - cost,
          marginPct: ratio(net - cost, net),
          avgTicket: docs ? net / docs : null,
          _usd: rate
        };
      });
    },
    kpis: [
      { key: "net", label: "Venta neta", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net"), better: "up" },
      { key: "documents", label: "Documentos", type: "int", value: (r) => sum(r, "documents"), better: "up", help: "Tickets de caja y notas de entrega" },
      {
        key: "avgTicket",
        label: "Ticket promedio",
        type: "money",
        value: (r) => ratio(sum(r, "net"), sum(r, "documents")),
        usd: (r) => {
          const u = sumUsd(r, "net");
          return u === null ? null : ratio(u, sum(r, "documents"));
        },
        better: "up"
      },
      { key: "margin", label: "Margen", type: "money", value: (r) => sum(r, "net") - sum(r, "cost"), usd: (r) => sumUsd(r, "margin"), better: "up" },
      { key: "marginPct", label: "Margen %", type: "pct", value: (r) => ratio(sum(r, "net") - sum(r, "cost"), sum(r, "net")), better: "up" },
      { key: "discount", label: "Descuentos", type: "money", value: (r) => sum(r, "discount"), usd: (r) => sumUsd(r, "discount"), better: "down" }
    ],
    charts: [
      {
        title: "Venta neta y margen por día",
        kind: "line",
        type: "money",
        series: [
          { key: "net", label: "Venta neta" },
          { key: "margin", label: "Margen" }
        ],
        data: (rows) => rows.map((r) => ({ label: ddmm(String(r.day)), net: Number(r.net), margin: Number(r.margin) }))
      },
      {
        title: "Venta por canal",
        kind: "donut",
        type: "money",
        series: [{ key: "value", label: "Venta neta" }],
        data: (rows) =>
          [
            { label: "Caja", value: sum(rows, "posNet") },
            { label: "Pedidos", value: sum(rows, "soNet") }
          ].filter((p) => p.value > 0)
      }
    ]
  },
  {
    code: "TOP_PRODUCTS",
    name: "Productos más y menos vendidos",
    description: "Ranking de productos por venta neta, con su participación y la variación contra el período anterior; al final, los que no se vendieron.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    columns: [
      { key: "rank", header: "Posición", type: "int", width: 9 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 38 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "units", header: "Unidades (inv.)", type: "qty", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "margin", header: "Margen", type: "money", total: true },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "share", header: "Participación", type: "pct" },
      { key: "prevNet", header: "Venta período anterior", type: "money", total: true },
      { key: "change", header: "Variación", type: "pct" }
    ],
    rows: async (ctx) => {
      const prev = previousRange(ctx.from, ctx.to);
      const [now, before, catalog] = await Promise.all([
        salesLines(ctx, ctx.from, ctx.to),
        salesLines(ctx, prev.from, prev.to),
        query<{ productId: string; productCode: string; productName: string; family: string | null }>(
          `SELECT p.id AS "productId", p.code AS "productCode", p.name AS "productName", f.name AS family
             FROM products p LEFT JOIN catalogs_product_families f ON f.id = p.family_id
            WHERE p.is_active AND p.is_sold`
        )
      ]);
      const cur = byProduct(now);
      const old = byProduct(before);
      for (const c of catalog) if (!cur.has(c.productId)) cur.set(c.productId, { ...c, units: 0, net: 0, netUsd: 0, cost: 0, hasUsd: false });
      const total = [...cur.values()].reduce((s, a) => s + a.net, 0);
      return [...cur.values()]
        .sort((a, b) => b.net - a.net || a.productName.localeCompare(b.productName))
        .map((a, i) => {
          const prevNet = old.get(a.productId)?.net ?? 0;
          return {
            rank: i + 1,
            productCode: a.productCode,
            productName: a.productName,
            family: a.family,
            units: a.units,
            net: a.net,
            netUsd: a.hasUsd ? a.netUsd : null,
            margin: a.net - a.cost,
            marginPct: ratio(a.net - a.cost, a.net),
            share: ratio(a.net, total),
            prevNet,
            change: pctChange(a.net, prevNet),
            _usd: impliedRate(a.net, a.netUsd, a.hasUsd)
          };
        });
    },
    compare: false,
    kpis: [
      { key: "sold", label: "Productos vendidos", type: "int", value: (r) => r.filter((x) => Number(x.net) > 0).length },
      { key: "noSales", label: "Sin ventas", type: "int", value: (r) => r.filter((x) => !Number(x.net)).length, help: "Productos activos marcados para venta que no se vendieron en el rango" },
      {
        key: "top10",
        label: "Peso de los 10 primeros",
        type: "pct",
        value: (r) => ratio(r.slice(0, 10).reduce((s, x) => s + Number(x.net), 0), sum(r, "net")),
        help: "Qué parte de la venta hacen los 10 productos que más venden"
      },
      { key: "leader", label: "Producto líder", type: "text", value: (r) => (Number(r[0]?.net) > 0 ? String(r[0].productName) : null) }
    ],
    charts: [
      {
        title: "Los 10 que más venden",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => rows.filter((r) => Number(r.net) > 0).slice(0, 10).map((r) => ({ label: String(r.productName), net: Number(r.net) }))
      },
      {
        title: "Los 10 que menos venden (con ventas)",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) =>
          rows
            .filter((r) => Number(r.net) > 0)
            .slice(-10)
            .reverse()
            .map((r) => ({ label: String(r.productName), net: Number(r.net) }))
      }
    ]
  },
  {
    code: "ABC_PRODUCTS",
    name: "Análisis ABC de productos",
    description: "Clasifica los productos vendidos por su aporte a la venta: A hasta el 80 %, B hasta el 95 % y C el resto, con su existencia actual.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    defaultDays: 90,
    compare: false,
    columns: [
      { key: "rank", header: "Posición", type: "int", width: 9 },
      { key: "class", header: "Clase", type: "text", width: 7 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 38 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "units", header: "Unidades (inv.)", type: "qty", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "share", header: "Participación", type: "pct" },
      { key: "cumShare", header: "Acumulado", type: "pct" },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "stock", header: "Existencia", type: "qty" },
      { key: "stockValue", header: "Valor en inventario", type: "money", total: true }
    ],
    rows: async (ctx) => {
      const lines = await salesLines(ctx, ctx.from, ctx.to);
      const stock = canView(ctx.access, "INV_STOCK")
        ? new Map(
            (
              await query<{ productId: string; quantity: number; value: number }>(
                `SELECT b.product_id AS "productId", SUM(b.quantity)::float AS quantity,
                        SUM(b.quantity * CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE 0 END)::float AS value
                   FROM stock_balances b
                   LEFT JOIN stock_valuation v ON v.warehouse_id = b.warehouse_id AND v.product_id = b.product_id
                  WHERE $1::uuid[] IS NULL OR b.warehouse_id = ANY($1)
                  GROUP BY b.product_id`,
                [warehouseScopeOf(ctx.access, "INV_STOCK")]
              )
            ).map((s) => [s.productId, s])
          )
        : null;
      const aggs = [...byProduct(lines).values()].filter((a) => a.net > 0).sort((a, b) => b.net - a.net);
      const total = aggs.reduce((s, a) => s + a.net, 0);
      let acc = 0;
      return aggs.map((a, i) => {
        const before = acc;
        acc += a.net;
        // La clase la decide dónde EMPIEZA el producto en el acumulado: el que cruza el 80 % aún es A
        const cls = before / total < 0.8 ? "A" : before / total < 0.95 ? "B" : "C";
        return {
          rank: i + 1,
          class: cls,
          productCode: a.productCode,
          productName: a.productName,
          family: a.family,
          units: a.units,
          net: a.net,
          netUsd: a.hasUsd ? a.netUsd : null,
          share: a.net / total,
          cumShare: acc / total,
          marginPct: ratio(a.net - a.cost, a.net),
          stock: stock?.get(a.productId)?.quantity ?? (stock ? 0 : null),
          stockValue: stock?.get(a.productId)?.value ?? (stock ? 0 : null),
          _usd: impliedRate(a.net, a.netUsd, a.hasUsd),
          _one: 1
        };
      });
    },
    kpis: [
      ...(["A", "B", "C"] as const).map((c) => ({
        key: `class${c}`,
        label: `Productos clase ${c}`,
        type: "int" as const,
        value: (r: Row[]) => r.filter((x) => x.class === c).length,
        help: { A: "Hacen el 80 % de la venta: no pueden faltar", B: "Hacen el siguiente 15 % de la venta", C: "Hacen el último 5 %: candidatos a revisar o liquidar" }[c]
      })),
      { key: "net", label: "Venta neta", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net") }
    ],
    charts: [
      { title: "Venta por clase", kind: "donut", type: "money", series: [{ key: "net", label: "Venta neta" }], data: (rows) => groupSum(rows, "class", ["net"], { order: ["A", "B", "C"] }).map((p) => ({ ...p, label: `Clase ${p.label}` })) },
      { title: "Productos por clase", kind: "bar", type: "int", series: [{ key: "_one", label: "Productos" }], data: (rows) => groupSum(rows, "class", ["_one"], { order: ["A", "B", "C"] }).map((p) => ({ ...p, label: `Clase ${p.label}` })) }
    ]
  },
  {
    code: "MARGIN_PRODUCTS",
    name: "Margen por producto",
    description: "Precio y costo promedio de venta, margen y margen % de cada producto vendido, de peor a mejor; marca los que dejan pérdida o menos del 20 %.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    columns: [
      { key: "status", header: "Estado", type: "text", width: 11 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 38 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "units", header: "Unidades (inv.)", type: "qty", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "cost", header: "Costo", type: "money", total: true },
      { key: "margin", header: "Margen", type: "money", total: true },
      { key: "marginUsd", header: "Margen USD", type: "money", usd: true, total: true },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "avgPrice", header: "Precio promedio", type: "money" },
      { key: "avgCost", header: "Costo de venta promedio", type: "money" },
      { key: "currentCost", header: "Costo promedio actual", type: "money" },
      { key: "listPrice", header: "Precio de lista", type: "money" },
      { key: "currentMarginPct", header: "Margen % a precio de lista", type: "pct" }
    ],
    rows: async (ctx) => {
      const lines = await salesLines(ctx, ctx.from, ctx.to);
      const aggs = [...byProduct(lines).values()].filter((a) => a.net > 0);
      const info = new Map(
        (
          await query<{ id: string; listPrice: number | null; currentCost: number | null }>(
            `SELECT p.id, p.sale_price::float AS "listPrice",
                    (SELECT CASE WHEN SUM(v.quantity) > 0 THEN SUM(v.total_value) / SUM(v.quantity) END FROM stock_valuation v WHERE v.product_id = p.id)::float AS "currentCost"
               FROM products p WHERE p.id = ANY($1)`,
            [aggs.map((a) => a.productId)]
          )
        ).map((p) => [p.id, p])
      );
      return aggs
        .map((a) => {
          const margin = a.net - a.cost;
          const pct = ratio(margin, a.net) ?? 0;
          const i = info.get(a.productId);
          const rate = impliedRate(a.net, a.netUsd, a.hasUsd);
          return {
            status: pct < 0 ? "Pérdida" : pct < 0.2 ? "Bajo" : "Normal",
            productCode: a.productCode,
            productName: a.productName,
            family: a.family,
            units: a.units,
            net: a.net,
            cost: a.cost,
            margin,
            marginUsd: rate ? margin / rate : null,
            marginPct: pct,
            avgPrice: ratio(a.net, a.units),
            avgCost: ratio(a.cost, a.units),
            currentCost: i?.currentCost ?? null,
            listPrice: i?.listPrice ?? null,
            currentMarginPct: i?.listPrice && i.currentCost !== null ? ratio(i.listPrice - i.currentCost, i.listPrice) : null,
            _usd: rate
          };
        })
        .sort((a, b) => a.marginPct - b.marginPct);
    },
    kpis: [
      { key: "margin", label: "Margen", type: "money", value: (r) => sum(r, "margin"), usd: (r) => sumUsd(r, "margin"), better: "up" },
      { key: "marginPct", label: "Margen %", type: "pct", value: (r) => ratio(sum(r, "margin"), sum(r, "net")), better: "up" },
      { key: "loss", label: "Con pérdida", type: "int", value: (r) => r.filter((x) => x.status === "Pérdida").length, better: "down", help: "Se vendieron por debajo de su costo" },
      { key: "low", label: "Margen bajo 20 %", type: "int", value: (r) => r.filter((x) => x.status === "Bajo").length, better: "down" }
    ],
    charts: [
      {
        title: "Margen % por familia",
        kind: "bar",
        type: "pct",
        horizontal: true,
        series: [{ key: "pct", label: "Margen %" }],
        data: (rows): ChartPoint[] =>
          groupSum(rows, (r) => String(r.family ?? "Sin familia"), ["net", "margin"])
            .map((p) => ({ label: p.label, pct: Math.round((ratio(Number(p.margin), Number(p.net)) ?? 0) * 1000) / 1000 }))
            .sort((a, b) => a.pct - b.pct)
      }
    ]
  }
];
