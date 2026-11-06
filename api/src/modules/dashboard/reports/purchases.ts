/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/purchases.ts
 * @description Reportes de compras: desempeño de proveedores, historial de precios, OC pendientes de
 * recibir y gasto por proveedor y familia
 *
 * @overview
 * Cuentan las OC que ya comprometen a la empresa (aprobadas, recibidas en parte, recibidas o
 * cerradas). Los precios se llevan a moneda base con la tasa de la OC y a la unidad de inventario,
 * para que dos compras en presentaciones distintas sean comparables.
 */

import { query } from "../../../db.js";
import { type ReportDef, type Row, distinct, groupSum, pctChange, previousRange, ratio, sum, sumUsd, usdOf } from "./types.js";

const EFFECTIVE = ["approved", "partially_received", "received", "closed"];
const AGING = ["Por llegar", "1 a 7 días", "8 a 30 días", "Más de 30 días"];
const agingOf = (days: number) => (days <= 0 ? AGING[0] : days <= 7 ? AGING[1] : days <= 30 ? AGING[2] : AGING[3]);

/** Nota del proveedor: cumplimiento de cantidad y de fecha, y lotes rechazados */
function rating(fill: number | null, onTime: number | null, rejected: number | null): string {
  if (fill === null) return "Sin datos";
  const bad = fill < 0.85 || (onTime ?? 1) < 0.7 || (rejected ?? 0) > 0.1;
  const good = fill >= 0.95 && (onTime ?? 1) >= 0.9 && (rejected ?? 0) <= 0.02;
  return good ? "Bueno" : bad ? "Malo" : "Regular";
}

/** Gasto por proveedor y familia en un rango, en moneda base y dólares */
async function spend(from: string, to: string) {
  return query<{ supplier: string; family: string; amount: number; usd: number | null }>(
    `SELECT COALESCE(s.trade_name, s.legal_name) AS supplier, COALESCE(f.name, 'Sin familia') AS family,
            SUM(d.net_amount * po.exchange_rate)::float AS amount,
            SUM(d.net_amount * po.exchange_rate / NULLIF(fn_rate_on('USD', po.order_date), 0))::float AS usd
       FROM purchase_orders_details d
       JOIN purchase_orders po ON po.id = d.purchase_order_id
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN products p ON p.id = d.product_id
       LEFT JOIN catalogs_product_families f ON f.id = p.family_id
      WHERE po.status = ANY($3) AND po.order_date BETWEEN $1 AND $2
      GROUP BY 1, 2`,
    [from, to, EFFECTIVE]
  );
}

export const PURCHASE_REPORTS: ReportDef[] = [
  {
    code: "SUPPLIER_PERFORMANCE",
    name: "Desempeño de proveedores",
    description: "Por proveedor, sobre las OC emitidas en el rango: cantidad recibida contra pedida, entregas a tiempo, plazo real, devoluciones y lotes rechazados por calidad.",
    group: "Compras",
    module: "PUR_ORDERS",
    ranged: true,
    defaultDays: 90,
    columns: [
      { key: "supplier", header: "Proveedor", type: "text", width: 32 },
      { key: "rating", header: "Evaluación", type: "text", width: 11 },
      { key: "orders", header: "OC", type: "int", total: true },
      { key: "lines", header: "Líneas", type: "int", total: true },
      { key: "amount", header: "Comprado", type: "money", total: true },
      { key: "amountUsd", header: "Comprado USD", type: "money", usd: true, total: true },
      { key: "fillRate", header: "Recibido / pedido", type: "pct" },
      { key: "onTime", header: "Líneas a tiempo", type: "pct" },
      { key: "leadDays", header: "Plazo real (días)", type: "qty" },
      { key: "lots", header: "Lotes recibidos", type: "int", total: true },
      { key: "rejected", header: "Lotes rechazados", type: "int", total: true },
      { key: "rejectedPct", header: "Rechazo %", type: "pct" },
      { key: "returns", header: "Devoluciones", type: "int", total: true }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `WITH l AS (
             SELECT po.id AS po_id, po.supplier_id, po.order_date, d.id, d.quantity, d.quantity_received,
                    COALESCE(d.expected_date, po.expected_date) AS due, d.net_amount * po.exchange_rate AS amount,
                    fn_rate_on('USD', po.order_date) AS usd,
                    (SELECT MIN(r.reception_date) FROM receptions_details rd JOIN receptions r ON r.id = rd.reception_id
                      WHERE rd.po_line_id = d.id AND r.kind = 'receipt' AND r.status = 'posted') AS first_rec,
                    (SELECT MAX(r.reception_date) FROM receptions_details rd JOIN receptions r ON r.id = rd.reception_id
                      WHERE rd.po_line_id = d.id AND r.kind = 'receipt' AND r.status = 'posted') AS last_rec
               FROM purchase_orders_details d JOIN purchase_orders po ON po.id = d.purchase_order_id
              WHERE po.status = ANY($3) AND po.order_date BETWEEN $1 AND $2
           ), lots AS (
             SELECT po.supplier_id, COUNT(*) AS n, COUNT(*) FILTER (WHERE lt.quality_status = 'rejected') AS rejected
               FROM lots lt JOIN purchase_orders po ON po.id = lt.purchase_order_id
              WHERE po.status = ANY($3) AND po.order_date BETWEEN $1 AND $2
              GROUP BY 1
           ), ret AS (
             SELECT po.supplier_id, COUNT(*) AS n
               FROM receptions r JOIN purchase_orders po ON po.id = r.purchase_order_id
              WHERE r.kind = 'return' AND r.status = 'posted' AND po.status = ANY($3) AND po.order_date BETWEEN $1 AND $2
              GROUP BY 1
           )
           SELECT COALESCE(s.trade_name, s.legal_name) AS supplier, COUNT(DISTINCT l.po_id)::int AS orders, COUNT(*)::int AS lines,
                  SUM(l.amount)::float AS amount, SUM(l.amount / NULLIF(l.usd, 0))::float AS "amountUsd",
                  AVG(LEAST(l.quantity_received / NULLIF(l.quantity, 0), 1))::float AS "fillRate",
                  (COUNT(*) FILTER (WHERE l.quantity_received >= l.quantity AND (l.due IS NULL OR l.last_rec <= l.due))::float
                    / NULLIF(COUNT(*) FILTER (WHERE l.quantity_received >= l.quantity OR l.due < CURRENT_DATE), 0))::float AS "onTime",
                  AVG(l.first_rec - l.order_date)::float AS "leadDays",
                  COALESCE(MAX(lots.n), 0)::int AS lots, COALESCE(MAX(lots.rejected), 0)::int AS rejected, COALESCE(MAX(ret.n), 0)::int AS returns
             FROM l JOIN suppliers s ON s.id = l.supplier_id
             LEFT JOIN lots ON lots.supplier_id = l.supplier_id
             LEFT JOIN ret ON ret.supplier_id = l.supplier_id
            GROUP BY s.id, s.trade_name, s.legal_name
            ORDER BY amount DESC`,
          [from, to, EFFECTIVE]
        )
      ).map((r) => {
        const rejectedPct = ratio(Number(r.rejected), Number(r.lots));
        return {
          ...r,
          leadDays: r.leadDays === null ? null : Math.round(Number(r.leadDays) * 10) / 10,
          rejectedPct,
          rating: rating(r.fillRate as number | null, r.onTime as number | null, rejectedPct),
          _usd: r.amountUsd ? Number(r.amount) / Number(r.amountUsd) : null
        };
      }),
    kpis: [
      { key: "suppliers", label: "Proveedores", type: "int", value: (r) => r.length },
      {
        key: "fill",
        label: "Recibido / pedido",
        type: "pct",
        value: (r) => ratio(r.reduce((s, x) => s + Number(x.fillRate) * Number(x.lines), 0), sum(r, "lines")),
        better: "up"
      },
      {
        key: "onTime",
        label: "Líneas a tiempo",
        type: "pct",
        value: (r) => {
          const w = r.filter((x) => x.onTime !== null);
          return ratio(w.reduce((s, x) => s + Number(x.onTime) * Number(x.lines), 0), sum(w, "lines"));
        },
        better: "up",
        help: "Recibidas completas a más tardar en la fecha esperada, entre las ya recibidas o vencidas"
      },
      { key: "rejected", label: "Lotes rechazados", type: "pct", value: (r) => ratio(sum(r, "rejected"), sum(r, "lots")), better: "down" },
      { key: "bad", label: "Proveedores a revisar", type: "int", value: (r) => r.filter((x) => x.rating === "Malo").length, better: "down" }
    ],
    charts: [
      {
        title: "Cumplimiento por proveedor",
        kind: "bar",
        type: "pct",
        horizontal: true,
        series: [
          { key: "fillRate", label: "Recibido / pedido" },
          { key: "onTime", label: "A tiempo" }
        ],
        data: (rows) =>
          rows.slice(0, 12).map((r) => ({ label: String(r.supplier), fillRate: Number(r.fillRate ?? 0), onTime: Number(r.onTime ?? 0) }))
      },
      {
        title: "Proveedores por evaluación",
        kind: "donut",
        type: "int",
        series: [{ key: "n", label: "Proveedores" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, n: 1 })), "rating", ["n"], { order: ["Bueno", "Regular", "Malo", "Sin datos"] }).filter((p) => Number(p.n) > 0)
      }
    ]
  },
  {
    code: "PURCHASE_PRICES",
    name: "Historial de precios de compra",
    description: "Precio por unidad de inventario de cada producto y proveedor en el rango: primero, último, mínimo y máximo, y su variación en moneda base y en dólares.",
    group: "Compras",
    module: "PUR_ORDERS",
    ranged: true,
    defaultDays: 180,
    compare: false,
    columns: [
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "supplier", header: "Proveedor", type: "text", width: 28 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "purchases", header: "Compras", type: "int", total: true },
      { key: "quantity", header: "Cantidad (inv.)", type: "qty" },
      { key: "firstDate", header: "Primera", type: "date" },
      { key: "firstPrice", header: "Primer precio", type: "money" },
      { key: "lastDate", header: "Última", type: "date" },
      { key: "lastPrice", header: "Último precio", type: "money" },
      { key: "minPrice", header: "Mínimo", type: "money" },
      { key: "maxPrice", header: "Máximo", type: "money" },
      { key: "avgPrice", header: "Promedio ponderado", type: "money" },
      { key: "change", header: "Variación", type: "pct" },
      { key: "lastUsd", header: "Último precio USD", type: "money", usd: true },
      { key: "usdChange", header: "Variación en USD", type: "pct" }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `WITH l AS (
             SELECT d.product_id, po.supplier_id, po.order_date, po.number, d.line_no, d.quantity * d.unit_factor AS qty,
                    d.net_amount * po.exchange_rate / NULLIF(d.quantity * d.unit_factor, 0) AS price,
                    fn_rate_on('USD', po.order_date) AS usd
               FROM purchase_orders_details d JOIN purchase_orders po ON po.id = d.purchase_order_id
              WHERE po.status = ANY($3) AND po.order_date BETWEEN $1 AND $2 AND d.quantity > 0
           )
           SELECT p.code AS "productCode", p.name AS "productName", COALESCE(s.trade_name, s.legal_name) AS supplier, u.code AS unit,
                  COUNT(*)::int AS purchases, SUM(l.qty)::float AS quantity,
                  to_char(MIN(l.order_date), 'YYYY-MM-DD') AS "firstDate", to_char(MAX(l.order_date), 'YYYY-MM-DD') AS "lastDate",
                  (array_agg(l.price ORDER BY l.order_date, l.number, l.line_no))[1]::float AS "firstPrice",
                  (array_agg(l.price ORDER BY l.order_date DESC, l.number DESC, l.line_no DESC))[1]::float AS "lastPrice",
                  (array_agg(l.usd ORDER BY l.order_date, l.number, l.line_no))[1]::float AS "_firstRate",
                  (array_agg(l.usd ORDER BY l.order_date DESC, l.number DESC, l.line_no DESC))[1]::float AS "_lastRate",
                  MIN(l.price)::float AS "minPrice", MAX(l.price)::float AS "maxPrice",
                  (SUM(l.price * l.qty) / NULLIF(SUM(l.qty), 0))::float AS "avgPrice"
             FROM l JOIN products p ON p.id = l.product_id JOIN suppliers s ON s.id = l.supplier_id JOIN catalogs_units u ON u.id = p.stock_unit_id
            GROUP BY p.id, p.code, p.name, s.id, s.trade_name, s.legal_name, u.code`,
          [from, to, EFFECTIVE]
        )
      )
        .map((r) => {
          const fu = usdOf(Number(r.firstPrice), r._firstRate);
          const lu = usdOf(Number(r.lastPrice), r._lastRate);
          return {
            ...r,
            change: Number(r.purchases) > 1 ? pctChange(Number(r.lastPrice), Number(r.firstPrice)) : null,
            lastUsd: lu,
            usdChange: Number(r.purchases) > 1 && fu && lu ? pctChange(lu, fu) : null,
            _usd: r._lastRate
          };
        })
        .sort((a, b) => (b.usdChange ?? b.change ?? -Infinity) - (a.usdChange ?? a.change ?? -Infinity)),
    kpis: [
      { key: "products", label: "Productos comprados", type: "int", value: (r) => distinct(r, "productCode") },
      { key: "up", label: "Subieron (en USD)", type: "int", value: (r) => r.filter((x) => Number(x.usdChange ?? x.change) > 0.005).length },
      { key: "down", label: "Bajaron (en USD)", type: "int", value: (r) => r.filter((x) => Number(x.usdChange ?? x.change) < -0.005).length },
      {
        key: "avg",
        label: "Variación promedio en USD",
        type: "pct",
        value: (r) => {
          const w = r.filter((x) => x.usdChange !== null);
          return w.length ? sum(w, "usdChange") / w.length : null;
        },
        help: "Entre productos comprados más de una vez al mismo proveedor; sin el efecto de la tasa"
      }
    ],
    charts: [
      {
        title: "Mayores alzas de precio (USD)",
        kind: "bar",
        type: "pct",
        horizontal: true,
        series: [{ key: "usdChange", label: "Variación en USD" }],
        data: (rows) =>
          rows
            .filter((r) => Number(r.usdChange) > 0)
            .slice(0, 10)
            .map((r) => ({ label: `${r.productName} · ${r.supplier}`, usdChange: Math.round(Number(r.usdChange) * 1000) / 1000 }))
      }
    ]
  },
  {
    code: "PO_PENDING",
    name: "OC pendientes de recibir",
    description: "Líneas de OC aprobadas que faltan por recibir: monto comprometido, fecha esperada y días de atraso, para reclamar al proveedor.",
    group: "Compras",
    module: "PUR_ORDERS",
    ranged: false,
    columns: [
      { key: "expectedDate", header: "Esperada", type: "date" },
      { key: "daysLate", header: "Días de atraso", type: "int" },
      { key: "aging", header: "Atraso", type: "text", width: 14 },
      { key: "number", header: "OC", type: "text", width: 16 },
      { key: "supplier", header: "Proveedor", type: "text", width: 30 },
      { key: "buyer", header: "Comprador", type: "text", width: 20 },
      { key: "warehouse", header: "Almacén", type: "text", width: 12 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "ordered", header: "Pedido", type: "qty" },
      { key: "pending", header: "Pendiente", type: "qty" },
      { key: "amount", header: "Monto pendiente", type: "money", total: true },
      { key: "amountUsd", header: "Monto pendiente USD", type: "money", usd: true, total: true }
    ],
    rows: async () =>
      (
        await query<Row>(
          `SELECT to_char(COALESCE(d.expected_date, po.expected_date), 'YYYY-MM-DD') AS "expectedDate",
                  (CURRENT_DATE - COALESCE(d.expected_date, po.expected_date, po.order_date))::int AS "daysLate",
                  po.number, po.id AS _po, COALESCE(s.trade_name, s.legal_name) AS supplier, b.name AS buyer, w.code AS warehouse,
                  p.code AS "productCode", p.name AS "productName", u.code AS unit, d.quantity::float AS ordered,
                  (d.quantity - d.quantity_received)::float AS pending,
                  ((d.quantity - d.quantity_received) * d.net_amount / NULLIF(d.quantity, 0) * po.exchange_rate)::float AS amount,
                  fn_rate_on('USD', CURRENT_DATE)::float AS _usd
             FROM purchase_orders_details d
             JOIN purchase_orders po ON po.id = d.purchase_order_id
             JOIN suppliers s ON s.id = po.supplier_id
             LEFT JOIN buyers b ON b.id = po.buyer_id
             LEFT JOIN warehouses w ON w.id = po.warehouse_id
             JOIN products p ON p.id = d.product_id
             JOIN catalogs_units u ON u.id = d.unit_id
            WHERE po.status IN ('approved', 'partially_received') AND d.quantity > d.quantity_received
            ORDER BY COALESCE(d.expected_date, po.expected_date, po.order_date), po.number, d.line_no`
        )
      ).map((r) => {
        const late = Math.max(0, Number(r.daysLate));
        return { ...r, daysLate: late, aging: agingOf(late), amountUsd: usdOf(Number(r.amount), r._usd) };
      }),
    kpis: [
      { key: "orders", label: "OC pendientes", type: "int", value: (r) => distinct(r, "_po") },
      { key: "amount", label: "Monto comprometido", type: "money", value: (r) => sum(r, "amount"), usd: (r) => sumUsd(r, "amount") },
      { key: "late", label: "OC atrasadas", type: "int", value: (r) => distinct(r.filter((x) => Number(x.daysLate) > 0), "_po"), better: "down" },
      {
        key: "lateAmount",
        label: "Monto atrasado",
        type: "money",
        value: (r) => sum(r.filter((x) => Number(x.daysLate) > 0), "amount"),
        usd: (r) => sumUsd(r.filter((x) => Number(x.daysLate) > 0), "amount"),
        better: "down"
      }
    ],
    charts: [
      {
        title: "Monto pendiente por atraso",
        kind: "bar",
        type: "money",
        series: [{ key: "amount", label: "Monto pendiente" }],
        data: (rows) => groupSum(rows, "aging", ["amount"], { order: AGING })
      },
      {
        title: "Monto pendiente por proveedor",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "amount", label: "Monto pendiente" }],
        data: (rows) => groupSum(rows, "supplier", ["amount"], { sortBy: "amount", top: 10 })
      }
    ]
  },
  {
    code: "PURCHASE_SPEND",
    name: "Gasto por proveedor y familia",
    description: "Cuánto se compró a cada proveedor en cada familia de producto, su participación y la variación contra el período anterior.",
    group: "Compras",
    module: "PUR_ORDERS",
    ranged: true,
    defaultDays: 90,
    compare: false,
    columns: [
      { key: "supplier", header: "Proveedor", type: "text", width: 32 },
      { key: "family", header: "Familia", type: "text", width: 24 },
      { key: "amount", header: "Comprado", type: "money", total: true },
      { key: "amountUsd", header: "Comprado USD", type: "money", usd: true, total: true },
      { key: "share", header: "Participación", type: "pct" },
      { key: "prevAmount", header: "Período anterior", type: "money", total: true },
      { key: "change", header: "Variación", type: "pct" }
    ],
    rows: async ({ from, to }) => {
      const prev = previousRange(from, to);
      const [now, before] = await Promise.all([spend(from, to), spend(prev.from, prev.to)]);
      const k = (r: { supplier: string; family: string }) => `${r.supplier}\u0000${r.family}`;
      const old = new Map(before.map((r) => [k(r), r.amount]));
      const total = now.reduce((s, r) => s + r.amount, 0);
      const rows = now.map((r) => ({
        supplier: r.supplier,
        family: r.family,
        amount: r.amount,
        amountUsd: r.usd,
        share: ratio(r.amount, total),
        prevAmount: old.get(k(r)) ?? 0,
        change: pctChange(r.amount, old.get(k(r)) ?? 0),
        _usd: r.usd ? r.amount / r.usd : null
      }));
      const seen = new Set(now.map(k));
      for (const r of before) {
        if (!seen.has(k(r))) rows.push({ supplier: r.supplier, family: r.family, amount: 0, amountUsd: 0, share: 0, prevAmount: r.amount, change: -1, _usd: null });
      }
      return rows.sort((a, b) => b.amount - a.amount || b.prevAmount - a.prevAmount);
    },
    kpis: [
      { key: "amount", label: "Comprado", type: "money", value: (r) => sum(r, "amount"), usd: (r) => sumUsd(r, "amount") },
      { key: "change", label: "Variación", type: "pct", value: (r) => pctChange(sum(r, "amount"), sum(r, "prevAmount")), help: "Contra el período anterior de igual duración" },
      { key: "suppliers", label: "Proveedores", type: "int", value: (r) => distinct(r.filter((x) => Number(x.amount) > 0), "supplier") },
      {
        key: "top",
        label: "Peso del principal",
        type: "pct",
        value: (r) => ratio(Number(groupSum(r, "supplier", ["amount"], { sortBy: "amount", top: 1 })[0]?.amount ?? 0), sum(r, "amount")),
        help: "Concentración: qué parte del gasto se lleva el proveedor principal"
      },
      { key: "leader", label: "Proveedor principal", type: "text", value: (r) => groupSum(r, "supplier", ["amount"], { sortBy: "amount", top: 1 }).find((p) => Number(p.amount) > 0)?.label ?? null }
    ],
    charts: [
      {
        title: "Gasto por proveedor",
        kind: "donut",
        type: "money",
        series: [{ key: "amount", label: "Comprado" }],
        data: (rows) => groupSum(rows, "supplier", ["amount"], { sortBy: "amount" }).filter((p) => Number(p.amount) > 0)
      },
      {
        title: "Gasto por familia: período y anterior",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [
          { key: "amount", label: "Período" },
          { key: "prevAmount", label: "Período anterior" }
        ],
        data: (rows) => groupSum(rows, "family", ["amount", "prevAmount"], { sortBy: "amount", top: 12 })
      }
    ]
  }
];
