/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/stockFlows.ts
 * @description Reportes de inventario sobre los movimientos del período: rotación y días de inventario,
 * kárdex valorado, ajustes y mermas, y variación del costo promedio
 *
 * @overview
 * El saldo inicial y final de un rango se reconstruyen desde el saldo de hoy restando lo que se movió
 * después: cada movimiento contabilizado (también los reversados y sus reversos, que se compensan)
 * suma o resta en su almacén; un traslado resta en el origen y suma en el destino. Así no hace falta
 * guardar fotos del inventario. El consumo (para la rotación) son solo las salidas reales: ventas,
 * despachos, consumos de producción y ajustes, sin traslados ni movimientos reversados.
 */

import { query } from "../../../db.js";
import { warehouseScopeOf } from "../access.js";
import { type Ctx, type ReportDef, type Row, daysIn, groupSum, pctChange, ratio, sum, sumUsd, usdOf } from "./types.js";

interface Flow {
  warehouse: string;
  productId: string;
  productCode: string;
  productName: string;
  family: string | null;
  unit: string;
  qtyNow: number;
  valueNow: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  /** Salidas reales (sin traslados ni reversos) */
  useQty: number;
  useValue: number;
  /** Neto de lo movido después del rango, para llegar al saldo final */
  afterQty: number;
  afterValue: number;
  usd: number | null;
}

/** Entradas, salidas y saldos por almacén y producto en el rango (alcance de almacenes del módulo) */
async function flows(ctx: Ctx, module: string): Promise<Flow[]> {
  return query<Flow>(
    `WITH legs AS (
       SELECT CASE WHEN m.direction = 'transfer' AND x.side = 'in' THEN m.target_warehouse_id ELSE m.warehouse_id END AS warehouse_id,
              d.product_id, m.movement_date AS day,
              CASE WHEN m.direction = 'in' OR (m.direction = 'transfer' AND x.side = 'in') THEN 1 ELSE -1 END AS sign,
              d.quantity AS qty, COALESCE(d.total_cost, d.quantity * COALESCE(d.unit_cost, 0)) AS value,
              (m.direction = 'out' AND m.status = 'posted' AND m.reversal_of_id IS NULL) AS is_use
         FROM inventory_movements m
         JOIN inventory_movements_details d ON d.movement_id = m.id
         CROSS JOIN LATERAL (SELECT 'out' AS side UNION ALL SELECT 'in' WHERE m.direction = 'transfer') x
        WHERE m.status IN ('posted', 'reversed') AND m.movement_date >= $2
     ), agg AS (
       SELECT warehouse_id, product_id,
              SUM(qty) FILTER (WHERE day <= $3 AND sign > 0) AS in_qty, SUM(value) FILTER (WHERE day <= $3 AND sign > 0) AS in_value,
              SUM(qty) FILTER (WHERE day <= $3 AND sign < 0) AS out_qty, SUM(value) FILTER (WHERE day <= $3 AND sign < 0) AS out_value,
              SUM(qty) FILTER (WHERE day <= $3 AND is_use) AS use_qty, SUM(value) FILTER (WHERE day <= $3 AND is_use) AS use_value,
              SUM(sign * qty) FILTER (WHERE day > $3) AS after_qty, SUM(sign * value) FILTER (WHERE day > $3) AS after_value
         FROM legs GROUP BY 1, 2
     ), now AS (
       SELECT b.warehouse_id, b.product_id, SUM(b.quantity) AS qty FROM stock_balances b GROUP BY 1, 2
     ), pairs AS (
       SELECT warehouse_id, product_id FROM agg UNION SELECT warehouse_id, product_id FROM now WHERE qty <> 0
     )
     SELECT w.code AS warehouse, p.id AS "productId", p.code AS "productCode", p.name AS "productName", f.name AS family, u.code AS unit,
            COALESCE(now.qty, 0)::float AS "qtyNow", COALESCE(v.total_value, 0)::float AS "valueNow",
            COALESCE(a.in_qty, 0)::float AS "inQty", COALESCE(a.in_value, 0)::float AS "inValue",
            COALESCE(a.out_qty, 0)::float AS "outQty", COALESCE(a.out_value, 0)::float AS "outValue",
            COALESCE(a.use_qty, 0)::float AS "useQty", COALESCE(a.use_value, 0)::float AS "useValue",
            COALESCE(a.after_qty, 0)::float AS "afterQty", COALESCE(a.after_value, 0)::float AS "afterValue",
            fn_rate_on('USD', $3::date)::float AS usd
       FROM pairs
       JOIN warehouses w ON w.id = pairs.warehouse_id
       JOIN products p ON p.id = pairs.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN catalogs_product_families f ON f.id = p.family_id
       LEFT JOIN agg a ON a.warehouse_id = pairs.warehouse_id AND a.product_id = pairs.product_id
       LEFT JOIN now ON now.warehouse_id = pairs.warehouse_id AND now.product_id = pairs.product_id
       LEFT JOIN stock_valuation v ON v.warehouse_id = pairs.warehouse_id AND v.product_id = pairs.product_id
      WHERE p.is_stockable AND ($1::uuid[] IS NULL OR pairs.warehouse_id = ANY($1))
      ORDER BY w.order_list, p.code`,
    [warehouseScopeOf(ctx.access, module), ctx.from, ctx.to]
  );
}

const closingOf = (f: Flow) => ({ qty: f.qtyNow - f.afterQty, value: f.valueNow - f.afterValue });
const openingOf = (f: Flow) => {
  const c = closingOf(f);
  return { qty: c.qty - f.inQty + f.outQty, value: c.value - f.inValue + f.outValue };
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Días de inventario sobre los que un producto se considera de baja rotación */
const SLOW_DAYS = 90;

const LOSS_CONCEPTS = ["AJ_NEG", "AJ_POS", "MERMA", "CONSUMO"];

export const STOCK_FLOW_REPORTS: ReportDef[] = [
  {
    code: "INVENTORY_TURNOVER",
    name: "Días de inventario y rotación",
    description: `Por producto: inventario promedio, costo de lo que salió, rotación anual y días de inventario. Marca el capital inmovilizado (más de ${SLOW_DAYS} días o sin salidas).`,
    group: "Inventario",
    module: "INV_STOCK",
    ranged: true,
    defaultDays: 90,
    compare: false,
    columns: [
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 36 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "openingValue", header: "Valor inicial", type: "money", total: true },
      { key: "closingValue", header: "Valor final", type: "money", total: true },
      { key: "closingUsd", header: "Valor final USD", type: "money", usd: true, total: true },
      { key: "avgValue", header: "Inventario promedio", type: "money", total: true },
      { key: "useValue", header: "Costo de las salidas", type: "money", total: true },
      { key: "turnover", header: "Rotación anual", type: "qty" },
      { key: "days", header: "Días de inventario", type: "int" },
      { key: "status", header: "Estado", type: "text", width: 14 }
    ],
    rows: async (ctx) => {
      const days = daysIn(ctx.from, ctx.to);
      const m = new Map<string, Row & { openingValue: number; closingValue: number; useValue: number }>();
      for (const f of await flows(ctx, "INV_STOCK")) {
        const a = m.get(f.productId) ?? { productCode: f.productCode, productName: f.productName, family: f.family, openingValue: 0, closingValue: 0, useValue: 0, _usd: f.usd };
        a.openingValue += openingOf(f).value;
        a.closingValue += closingOf(f).value;
        a.useValue += f.useValue;
        m.set(f.productId, a);
      }
      return [...m.values()]
        .filter((a) => Math.abs(a.closingValue) >= 0.01 || a.useValue > 0)
        .map((a) => {
          const avg = (a.openingValue + a.closingValue) / 2;
          const daily = a.useValue / days;
          const daysOf = daily > 0 ? a.closingValue / daily : null;
          return {
            ...a,
            openingValue: r2(a.openingValue),
            closingValue: r2(a.closingValue),
            closingUsd: usdOf(a.closingValue, a._usd),
            avgValue: r2(avg),
            turnover: avg > 0 ? Math.round(((a.useValue / avg) * 365 * 100) / days) / 100 : null,
            days: daysOf === null ? null : Math.round(daysOf),
            status: daysOf === null ? "Sin salidas" : daysOf > SLOW_DAYS ? "Lenta" : daysOf < 15 ? "Rápida" : "Normal"
          };
        })
        .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || b.closingValue - a.closingValue);
    },
    kpis: [
      { key: "value", label: "Valor del inventario", type: "money", value: (r) => sum(r, "closingValue"), usd: (r) => sumUsd(r, "closingValue") },
      { key: "use", label: "Costo de las salidas", type: "money", value: (r) => sum(r, "useValue"), usd: (r) => sumUsd(r, "useValue") },
      {
        key: "turnover",
        label: "Rotación anual",
        type: "qty",
        value: (r, ctx) => {
          const avg = sum(r, "avgValue");
          return avg > 0 ? Math.round(((sum(r, "useValue") / avg) * 365 * 100) / daysIn(ctx.from, ctx.to)) / 100 : null;
        },
        help: "Veces al año que se renueva el inventario al ritmo de salidas del rango"
      },
      {
        key: "days",
        label: "Días de inventario",
        type: "int",
        value: (r, ctx) => {
          const daily = sum(r, "useValue") / daysIn(ctx.from, ctx.to);
          return daily > 0 ? Math.round(sum(r, "closingValue") / daily) : null;
        },
        help: "Cuántos días alcanza el inventario actual al ritmo de salidas del rango"
      },
      {
        key: "idle",
        label: "Capital inmovilizado",
        type: "money",
        value: (r) => sum(r.filter((x) => x.status === "Lenta" || x.status === "Sin salidas"), "closingValue"),
        usd: (r) => sumUsd(r.filter((x) => x.status === "Lenta" || x.status === "Sin salidas"), "closingValue"),
        help: `Valor de lo que dura más de ${SLOW_DAYS} días o no tuvo salidas`
      }
    ],
    charts: [
      {
        title: "Días de inventario por familia",
        kind: "bar",
        type: "int",
        horizontal: true,
        series: [{ key: "days", label: "Días" }],
        data: (rows, ctx) =>
          groupSum(rows, (r) => String(r.family ?? "Sin familia"), ["closingValue", "useValue"])
            .map((p) => {
              const daily = Number(p.useValue) / daysIn(ctx.from, ctx.to);
              return { label: p.label, days: daily > 0 ? Math.round(Number(p.closingValue) / daily) : 0 };
            })
            .sort((a, b) => b.days - a.days)
      },
      {
        title: "Capital inmovilizado por estado",
        kind: "donut",
        type: "money",
        series: [{ key: "closingValue", label: "Valor final" }],
        data: (rows) => groupSum(rows, "status", ["closingValue"], { order: ["Sin salidas", "Lenta", "Normal", "Rápida"] })
      }
    ]
  },
  {
    code: "KARDEX",
    name: "Kárdex valorado",
    description: "Por almacén y producto: saldo inicial, entradas, salidas y saldo final del rango, en cantidad y costo, para auditar el inventario.",
    group: "Inventario",
    module: "INV_MOVEMENTS",
    ranged: true,
    compare: false,
    columns: [
      { key: "warehouse", header: "Almacén", type: "text", width: 12 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "openingQty", header: "Saldo inicial", type: "qty" },
      { key: "openingValue", header: "Valor inicial", type: "money", total: true },
      { key: "inQty", header: "Entradas", type: "qty" },
      { key: "inValue", header: "Valor entradas", type: "money", total: true },
      { key: "outQty", header: "Salidas", type: "qty" },
      { key: "outValue", header: "Valor salidas", type: "money", total: true },
      { key: "closingQty", header: "Saldo final", type: "qty" },
      { key: "closingValue", header: "Valor final", type: "money", total: true },
      { key: "unitCost", header: "Costo unitario final", type: "money" }
    ],
    rows: async (ctx) =>
      (await flows(ctx, "INV_MOVEMENTS"))
        .map((f) => {
          const o = openingOf(f);
          const c = closingOf(f);
          return {
            warehouse: f.warehouse,
            productCode: f.productCode,
            productName: f.productName,
            unit: f.unit,
            openingQty: o.qty,
            openingValue: r2(o.value),
            inQty: f.inQty,
            inValue: r2(f.inValue),
            outQty: f.outQty,
            outValue: r2(f.outValue),
            closingQty: c.qty,
            closingValue: r2(c.value),
            unitCost: c.qty > 0 ? r2(c.value / c.qty) : null,
            _usd: f.usd
          };
        })
        .filter((r) => r.openingQty || r.inQty || r.outQty || r.closingQty),
    kpis: [
      { key: "opening", label: "Valor inicial", type: "money", value: (r) => sum(r, "openingValue"), usd: (r) => sumUsd(r, "openingValue") },
      { key: "in", label: "Entradas", type: "money", value: (r) => sum(r, "inValue"), usd: (r) => sumUsd(r, "inValue") },
      { key: "out", label: "Salidas", type: "money", value: (r) => sum(r, "outValue"), usd: (r) => sumUsd(r, "outValue") },
      { key: "closing", label: "Valor final", type: "money", value: (r) => sum(r, "closingValue"), usd: (r) => sumUsd(r, "closingValue") }
    ],
    charts: [
      {
        title: "Entradas y salidas por almacén",
        kind: "bar",
        type: "money",
        series: [
          { key: "inValue", label: "Entradas" },
          { key: "outValue", label: "Salidas" }
        ],
        data: (rows) => groupSum(rows, "warehouse", ["inValue", "outValue"], { sortBy: "inValue" })
      }
    ]
  },
  {
    code: "ADJUSTMENTS",
    name: "Ajustes y mermas",
    description: "Ajustes de inventario, mermas y consumos internos contabilizados, valorados al costo, por motivo y producto.",
    group: "Inventario",
    module: "INV_MOVEMENTS",
    ranged: true,
    columns: [
      { key: "day", header: "Fecha", type: "date" },
      { key: "number", header: "Movimiento", type: "text", width: 14 },
      { key: "concept", header: "Motivo", type: "text", width: 22 },
      { key: "warehouse", header: "Almacén", type: "text", width: 12 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "lotCode", header: "Lote", type: "text", width: 14 },
      { key: "quantity", header: "Cantidad", type: "qty" },
      { key: "value", header: "Valor", type: "money", total: true },
      { key: "valueUsd", header: "Valor USD", type: "money", usd: true, total: true },
      { key: "notes", header: "Observación", type: "text", width: 36 },
      { key: "user", header: "Registró", type: "text", width: 22 }
    ],
    rows: async ({ access, from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(m.movement_date, 'YYYY-MM-DD') AS day, m.number, c.name AS concept, c.code AS _concept, w.code AS warehouse,
                  p.code AS "productCode", p.name AS "productName", l.lot_code AS "lotCode",
                  (CASE WHEN m.direction = 'out' THEN -1 ELSE 1 END * d.quantity)::float AS quantity,
                  (CASE WHEN m.direction = 'out' THEN -1 ELSE 1 END * COALESCE(d.total_cost, 0))::float AS value,
                  COALESCE(NULLIF(d.notes, ''), m.notes) AS notes, u.names AS "user", fn_rate_on('USD', m.movement_date)::float AS _usd
             FROM inventory_movements m
             JOIN catalogs_movement_concepts c ON c.id = m.concept_id
             JOIN inventory_movements_details d ON d.movement_id = m.id
             JOIN warehouses w ON w.id = m.warehouse_id
             JOIN products p ON p.id = d.product_id
             LEFT JOIN lots l ON l.id = d.lot_id
             LEFT JOIN users u ON u.id = m.created_by
            WHERE m.status = 'posted' AND m.reversal_of_id IS NULL AND c.code = ANY($4)
              AND m.movement_date BETWEEN $2 AND $3 AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1))
            ORDER BY m.movement_date, m.number, d.line_no`,
          [warehouseScopeOf(access, "INV_MOVEMENTS"), from, to, LOSS_CONCEPTS]
        )
      ).map((r) => ({ ...r, valueUsd: usdOf(Number(r.value), r._usd), _loss: Number(r.value) < 0 ? -Number(r.value) : 0 })),
    kpis: [
      {
        key: "losses",
        label: "Pérdidas",
        type: "money",
        value: (r) => sum(r.filter((x) => x._concept !== "CONSUMO"), "_loss"),
        usd: (r) => {
          const u = sumUsd(r.filter((x) => x._concept !== "CONSUMO" && Number(x.value) < 0), "value");
          return u === null ? null : -u;
        },
        better: "down",
        help: "Ajustes negativos y mermas, al costo"
      },
      {
        key: "gains",
        label: "Ajustes positivos",
        type: "money",
        value: (r) => sum(r.filter((x) => Number(x.value) > 0), "value"),
        usd: (r) => sumUsd(r.filter((x) => Number(x.value) > 0), "value")
      },
      { key: "net", label: "Efecto neto", type: "money", value: (r) => sum(r, "value"), usd: (r) => sumUsd(r, "value"), better: "up" },
      {
        key: "internal",
        label: "Consumo interno",
        type: "money",
        value: (r) => sum(r.filter((x) => x._concept === "CONSUMO"), "_loss"),
        better: "down"
      }
    ],
    charts: [
      {
        title: "Valor por motivo",
        kind: "donut",
        type: "money",
        series: [{ key: "abs", label: "Valor" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, abs: Math.abs(Number(r.value)) })), "concept", ["abs"], { sortBy: "abs" })
      },
      {
        title: "Productos con más pérdida",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "_loss", label: "Pérdida" }],
        data: (rows) => groupSum(rows, "productName", ["_loss"], { sortBy: "_loss", top: 10 }).filter((p) => Number(p._loss) > 0)
      }
    ]
  },
  {
    code: "COST_VARIATION",
    name: "Variación del costo promedio",
    description: "Productos cuyo costo promedio cambió en el rango, en moneda base y en dólares, con el margen que deja hoy el precio de lista.",
    group: "Inventario",
    module: "INV_STOCK",
    ranged: true,
    compare: false,
    columns: [
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 36 },
      { key: "family", header: "Familia", type: "text", width: 22 },
      { key: "costBefore", header: "Costo al inicio", type: "money" },
      { key: "costNow", header: "Costo al final", type: "money" },
      { key: "change", header: "Variación", type: "pct" },
      { key: "usdBefore", header: "Costo inicio USD", type: "money", usd: true },
      { key: "usdNow", header: "Costo final USD", type: "money", usd: true },
      { key: "usdChange", header: "Variación en USD", type: "pct" },
      { key: "listPrice", header: "Precio de lista", type: "money" },
      { key: "marginBefore", header: "Margen % antes", type: "pct" },
      { key: "marginNow", header: "Margen % ahora", type: "pct" },
      { key: "status", header: "Estado", type: "text", width: 16 }
    ],
    rows: async ({ access, from, to }) =>
      (
        await query<Row>(
          `WITH last AS (
             SELECT DISTINCT ON (m.warehouse_id, d.product_id, m.movement_date < $2)
                    d.product_id, (m.movement_date < $2) AS before, d.avg_cost_after AS cost, GREATEST(d.balance_after, 0) AS qty
               FROM inventory_movements m JOIN inventory_movements_details d ON d.movement_id = m.id
              WHERE m.status IN ('posted', 'reversed') AND m.direction IN ('in', 'out') AND m.movement_date <= $3
                AND d.avg_cost_after IS NOT NULL AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1))
              ORDER BY m.warehouse_id, d.product_id, m.movement_date < $2, m.movement_date DESC, m.posted_at DESC, d.line_no DESC
           ), c AS (
             SELECT product_id, before,
                    COALESCE(SUM(cost * qty) / NULLIF(SUM(qty), 0), AVG(cost)) AS cost
               FROM last GROUP BY 1, 2
           )
           SELECT p.code AS "productCode", p.name AS "productName", f.name AS family,
                  b.cost::float AS "costBefore", n.cost::float AS "costNow", p.sale_price::float AS "listPrice",
                  fn_rate_on('USD', $2::date)::float AS "_rateFrom", fn_rate_on('USD', $3::date)::float AS "_rateTo"
             FROM c n
             JOIN c b ON b.product_id = n.product_id AND b.before
             JOIN products p ON p.id = n.product_id
             LEFT JOIN catalogs_product_families f ON f.id = p.family_id
            WHERE NOT n.before AND b.cost > 0 AND abs(n.cost - b.cost) / b.cost >= 0.005`,
          [warehouseScopeOf(access, "INV_STOCK"), from, to]
        )
      )
        .map((r) => {
          const before = Number(r.costBefore);
          const now = Number(r.costNow);
          const price = Number(r.listPrice) || null;
          const ub = usdOf(before, r._rateFrom);
          const un = usdOf(now, r._rateTo);
          const marginNow = price ? ratio(price - now, price) : null;
          return {
            ...r,
            change: pctChange(now, before),
            usdBefore: ub,
            usdNow: un,
            usdChange: ub && un ? pctChange(un, ub) : null,
            marginBefore: price ? ratio(price - before, price) : null,
            marginNow,
            status: marginNow !== null && marginNow < 0 ? "Precio bajo costo" : marginNow !== null && marginNow < 0.2 ? "Revisar precio" : now > before ? "Subió" : "Bajó",
            _usd: r._rateTo
          };
        })
        .sort((a, b) => Number(b.change) - Number(a.change)),
    kpis: [
      { key: "up", label: "Subieron de costo", type: "int", value: (r) => r.filter((x) => Number(x.change) > 0).length },
      { key: "down", label: "Bajaron de costo", type: "int", value: (r) => r.filter((x) => Number(x.change) < 0).length },
      { key: "avg", label: "Variación promedio", type: "pct", value: (r) => (r.length ? sum(r, "change") / r.length : null) },
      {
        key: "usdAvg",
        label: "Variación promedio en USD",
        type: "pct",
        value: (r) => {
          const u = r.filter((x) => x.usdChange !== null);
          return u.length ? sum(u, "usdChange") / u.length : null;
        },
        help: "Sin el efecto de la tasa de cambio: cuánto cambió el costo real"
      },
      {
        key: "review",
        label: "Precios por revisar",
        type: "int",
        value: (r) => r.filter((x) => x.status === "Revisar precio" || x.status === "Precio bajo costo").length,
        help: "El precio de lista deja menos del 20 % de margen con el costo nuevo"
      }
    ],
    charts: [
      {
        title: "Los 10 que más subieron",
        kind: "bar",
        type: "pct",
        horizontal: true,
        series: [{ key: "change", label: "Variación" }],
        data: (rows) =>
          rows
            .filter((r) => Number(r.change) > 0)
            .slice(0, 10)
            .map((r) => ({ label: String(r.productName), change: Math.round(Number(r.change) * 1000) / 1000 }))
      }
    ]
  }
];
