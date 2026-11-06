/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/customers.ts
 * @description Reportes de clientes y de pedidos: clientes principales, clientes inactivos, órdenes de
 * venta pendientes de despacho y cumplimiento de entregas
 *
 * @overview
 * Clientes parte de salesLines (caja + pedidos). El cliente genérico de mostrador (el predeterminado
 * de una caja) se muestra aparte: junta a todos los que no se identificaron y no es un cliente que se
 * pueda cuidar o recuperar, así que no entra en el ranking ni en los inactivos.
 */

import { query } from "../../../db.js";
import { ownerScopeOf } from "../access.js";
import { type SaleLine, SALES_MODULES, salesLines } from "./sales.js";
import { type ReportDef, type Row, daysIn, distinct, groupSum, pctChange, previousRange, ratio, shiftIso, sum, sumUsd, usdOf } from "./types.js";

/** Meses de historia que se miran para decidir si un cliente «compraba» */
const LOOKBACK_DAYS = 365;

interface CustomerAgg {
  customer: string;
  counter: boolean;
  docs: Set<string>;
  net: number;
  usd: number;
  hasUsd: boolean;
  cost: number;
  first: string;
  last: string;
}

function byCustomer(lines: SaleLine[]): Map<string, CustomerAgg> {
  const m = new Map<string, CustomerAgg>();
  for (const l of lines) {
    const k = l.customerId ?? "none";
    const a = m.get(k) ?? { customer: l.customer ?? "Sin cliente", counter: l.counter || !l.customerId, docs: new Set(), net: 0, usd: 0, hasUsd: false, cost: 0, first: l.day, last: l.day };
    a.docs.add(`${l.channel}:${l.docId}`);
    a.net += l.net;
    a.cost += l.cost;
    if (l.usd) {
      a.usd += l.net / l.usd;
      a.hasUsd = true;
    }
    if (l.day < a.first) a.first = l.day;
    if (l.day > a.last) a.last = l.day;
    m.set(k, a);
  }
  return m;
}

const AGING = ["Al día", "1 a 7 días", "8 a 30 días", "Más de 30 días"];
const agingOf = (days: number) => (days <= 0 ? AGING[0] : days <= 7 ? AGING[1] : days <= 30 ? AGING[2] : AGING[3]);

export const CUSTOMER_REPORTS: ReportDef[] = [
  {
    code: "TOP_CUSTOMERS",
    name: "Clientes principales",
    description: "Ranking de clientes por venta neta: compras, ticket promedio, frecuencia y días desde su última compra, contra el período anterior.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    defaultDays: 90,
    compare: false,
    columns: [
      { key: "rank", header: "Posición", type: "int", width: 9 },
      { key: "customer", header: "Cliente", type: "text", width: 34 },
      { key: "kind", header: "Tipo", type: "text", width: 13 },
      { key: "documents", header: "Compras", type: "int", total: true },
      { key: "net", header: "Venta neta", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD", type: "money", usd: true, total: true },
      { key: "share", header: "Participación", type: "pct" },
      { key: "avgTicket", header: "Ticket promedio", type: "money" },
      { key: "marginPct", header: "Margen %", type: "pct" },
      { key: "everyDays", header: "Compra cada (días)", type: "int" },
      { key: "lastDay", header: "Última compra", type: "date" },
      { key: "daysSince", header: "Días sin comprar", type: "int" },
      { key: "prevNet", header: "Venta período anterior", type: "money", total: true },
      { key: "change", header: "Variación", type: "pct" }
    ],
    rows: async (ctx) => {
      const prev = previousRange(ctx.from, ctx.to);
      const [now, before] = await Promise.all([salesLines(ctx, ctx.from, ctx.to), salesLines(ctx, prev.from, prev.to)]);
      const cur = byCustomer(now);
      const old = byCustomer(before);
      const total = [...cur.values()].reduce((s, a) => s + a.net, 0);
      const ranked = [...cur.entries()].sort(([, a], [, b]) => Number(a.counter) - Number(b.counter) || b.net - a.net);
      let rank = 0;
      return ranked.map(([k, a]) => {
        const docs = a.docs.size;
        const prevNet = old.get(k)?.net ?? 0;
        return {
          rank: a.counter ? null : ++rank,
          customer: a.customer,
          kind: a.counter ? "Mostrador" : "Identificado",
          documents: docs,
          net: a.net,
          netUsd: a.hasUsd ? a.usd : null,
          share: ratio(a.net, total),
          avgTicket: ratio(a.net, docs),
          marginPct: ratio(a.net - a.cost, a.net),
          everyDays: docs > 1 ? Math.round((daysIn(a.first, a.last) - 1) / (docs - 1)) : null,
          lastDay: a.last,
          daysSince: daysIn(a.last, ctx.to) - 1,
          prevNet,
          change: pctChange(a.net, prevNet),
          _usd: a.hasUsd && a.usd ? a.net / a.usd : null,
          _counter: a.counter
        };
      });
    },
    kpis: [
      { key: "customers", label: "Clientes que compraron", type: "int", value: (r) => r.filter((x) => !x._counter).length, help: "Sin contar al cliente genérico de mostrador" },
      {
        key: "identified",
        label: "Venta a clientes identificados",
        type: "pct",
        value: (r) => ratio(sum(r.filter((x) => !x._counter), "net"), sum(r, "net"))
      },
      {
        key: "top10",
        label: "Peso de los 10 primeros",
        type: "pct",
        value: (r) => ratio(sum(r.filter((x) => !x._counter).slice(0, 10), "net"), sum(r, "net")),
        help: "Dependencia de pocos clientes: qué parte de la venta hacen los 10 principales"
      },
      { key: "net", label: "Venta neta", type: "money", value: (r) => sum(r, "net"), usd: (r) => sumUsd(r, "net") },
      { key: "leader", label: "Cliente principal", type: "text", value: (r) => (r.find((x) => !x._counter)?.customer as string) ?? null }
    ],
    charts: [
      {
        title: "Los 10 clientes principales",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [
          { key: "net", label: "Período" },
          { key: "prevNet", label: "Período anterior" }
        ],
        data: (rows) =>
          rows
            .filter((r) => !r._counter)
            .slice(0, 10)
            .map((r) => ({ label: String(r.customer), net: Number(r.net), prevNet: Number(r.prevNet) }))
      },
      {
        title: "Venta identificada y de mostrador",
        kind: "donut",
        type: "money",
        series: [{ key: "net", label: "Venta neta" }],
        data: (rows) => groupSum(rows, "kind", ["net"], { sortBy: "net" })
      }
    ]
  },
  {
    code: "INACTIVE_CUSTOMERS",
    name: "Clientes inactivos",
    description: "Clientes que compraron en los 12 meses anteriores al rango y no volvieron a comprar en él: a quién llamar primero, por lo que compraban.",
    group: "Ventas",
    module: SALES_MODULES,
    ranged: true,
    defaultDays: 60,
    compare: false,
    columns: [
      { key: "customer", header: "Cliente", type: "text", width: 34 },
      { key: "code", header: "Código", type: "text", width: 14 },
      { key: "seller", header: "Vendedor", type: "text", width: 22 },
      { key: "email", header: "Correo", type: "text", width: 28 },
      { key: "lastDay", header: "Última compra", type: "date" },
      { key: "daysSince", header: "Días sin comprar", type: "int" },
      { key: "documents", header: "Compras (12 meses)", type: "int", total: true },
      { key: "net", header: "Venta neta (12 meses)", type: "money", total: true },
      { key: "netUsd", header: "Venta neta USD (12 meses)", type: "money", usd: true, total: true },
      { key: "avgTicket", header: "Ticket promedio", type: "money" },
      { key: "monthly", header: "Venta mensual promedio", type: "money", total: true }
    ],
    rows: async (ctx) => {
      const histFrom = shiftIso(ctx.from, -LOOKBACK_DAYS);
      const [hist, now] = await Promise.all([salesLines(ctx, histFrom, shiftIso(ctx.from, -1)), salesLines(ctx, ctx.from, ctx.to)]);
      const active = new Set(now.map((l) => l.customerId));
      const lost = [...byCustomer(hist).entries()].filter(([k, a]) => !a.counter && !active.has(k));
      const info = new Map(
        (
          await query<{ id: string; code: string; email: string | null; seller: string | null }>(
            `SELECT c.id, c.code, c.email, s.name AS seller FROM customers c LEFT JOIN sellers s ON s.id = c.seller_id WHERE c.id = ANY($1)`,
            [lost.map(([k]) => k)]
          )
        ).map((c) => [c.id, c])
      );
      return lost
        .map(([k, a]) => {
          const i = info.get(k);
          return {
            customer: a.customer,
            code: i?.code ?? null,
            seller: i?.seller ?? null,
            email: i?.email ?? null,
            lastDay: a.last,
            daysSince: daysIn(a.last, ctx.to) - 1,
            documents: a.docs.size,
            net: a.net,
            netUsd: a.hasUsd ? a.usd : null,
            avgTicket: ratio(a.net, a.docs.size),
            monthly: (a.net / LOOKBACK_DAYS) * 30,
            _usd: a.hasUsd && a.usd ? a.net / a.usd : null
          };
        })
        .sort((a, b) => b.net - a.net);
    },
    kpis: [
      { key: "customers", label: "Clientes inactivos", type: "int", value: (r) => r.length, better: "down" },
      {
        key: "monthly",
        label: "Venta mensual en riesgo",
        type: "money",
        value: (r) => sum(r, "monthly"),
        usd: (r) => sumUsd(r, "monthly"),
        help: "Lo que estos clientes compraban en promedio por mes en los 12 meses anteriores"
      },
      { key: "days", label: "Días sin comprar (promedio)", type: "int", value: (r) => (r.length ? Math.round(sum(r, "daysSince") / r.length) : null) }
    ],
    charts: [
      {
        title: "Los 10 inactivos que más compraban",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "net", label: "Venta neta (12 meses)" }],
        data: (rows) => rows.slice(0, 10).map((r) => ({ label: String(r.customer), net: Number(r.net) }))
      }
    ]
  },
  {
    code: "SO_BACKLOG",
    name: "Órdenes de venta pendientes de despacho",
    description: "Líneas confirmadas que faltan por despachar: atraso contra la fecha pedida, monto pendiente y si la existencia del almacén alcanza.",
    group: "Ventas",
    module: "SAL_ORDERS",
    ranged: false,
    columns: [
      { key: "requestedDate", header: "Fecha pedida", type: "date" },
      { key: "daysLate", header: "Días de atraso", type: "int" },
      { key: "aging", header: "Atraso", type: "text", width: 14 },
      { key: "order", header: "OV", type: "text", width: 16 },
      { key: "customer", header: "Cliente", type: "text", width: 30 },
      { key: "seller", header: "Vendedor", type: "text", width: 20 },
      { key: "warehouse", header: "Almacén", type: "text", width: 12 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "pending", header: "Pendiente", type: "qty" },
      { key: "stock", header: "Existencia (inv.)", type: "qty" },
      { key: "canShip", header: "¿Alcanza?", type: "text", width: 10 },
      { key: "amount", header: "Monto pendiente", type: "money", total: true },
      { key: "amountUsd", header: "Monto pendiente USD", type: "money", usd: true, total: true }
    ],
    rows: async ({ access, userId }) =>
      (
        await query<Row>(
          `SELECT to_char(COALESCE(so.requested_date, so.order_date), 'YYYY-MM-DD') AS "requestedDate",
                  (CURRENT_DATE - COALESCE(so.requested_date, so.order_date))::int AS "daysLate",
                  so.number AS "order", COALESCE(c.trade_name, c.legal_name) AS customer, sl.name AS seller, w.code AS warehouse,
                  p.code AS "productCode", p.name AS "productName", u.code AS unit,
                  (d.quantity - d.quantity_delivered)::float AS pending,
                  ((d.quantity - d.quantity_delivered) * d.unit_factor)::float AS "pendingStock",
                  COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.warehouse_id = so.warehouse_id AND b.product_id = d.product_id), 0)::float AS stock,
                  ((d.quantity - d.quantity_delivered) * d.net_amount / NULLIF(d.quantity, 0) * so.exchange_rate)::float AS amount,
                  so.id AS _so, fn_rate_on('USD', CURRENT_DATE)::float AS _usd
             FROM sales_orders_details d
             JOIN sales_orders so ON so.id = d.sales_order_id
             JOIN customers c ON c.id = so.customer_id
             LEFT JOIN sellers sl ON sl.id = so.seller_id
             JOIN warehouses w ON w.id = so.warehouse_id
             JOIN products p ON p.id = d.product_id
             JOIN catalogs_units u ON u.id = d.unit_id
            WHERE so.status IN ('confirmed', 'partially_delivered') AND d.quantity > d.quantity_delivered
              AND ($1::uuid IS NULL OR so.created_by = $1)
            ORDER BY COALESCE(so.requested_date, so.order_date), so.number, d.line_no`,
          [ownerScopeOf(access, "SAL_ORDERS", userId)]
        )
      ).map(({ pendingStock, ...r }) => {
        const late = Math.max(0, Number(r.daysLate));
        return {
          ...r,
          daysLate: late,
          aging: agingOf(late),
          canShip: Number(r.stock) >= Number(pendingStock) ? "Sí" : Number(r.stock) > 0 ? "Parcial" : "No",
          amountUsd: usdOf(Number(r.amount), r._usd)
        };
      }),
    kpis: [
      { key: "orders", label: "OV pendientes", type: "int", value: (r) => distinct(r, "_so") },
      { key: "amount", label: "Monto por despachar", type: "money", value: (r) => sum(r, "amount"), usd: (r) => sumUsd(r, "amount") },
      { key: "late", label: "OV atrasadas", type: "int", value: (r) => distinct(r.filter((x) => Number(x.daysLate) > 0), "_so"), better: "down" },
      {
        key: "lateAmount",
        label: "Monto atrasado",
        type: "money",
        value: (r) => sum(r.filter((x) => Number(x.daysLate) > 0), "amount"),
        usd: (r) => sumUsd(r.filter((x) => Number(x.daysLate) > 0), "amount"),
        better: "down"
      },
      { key: "noStock", label: "Líneas sin existencia suficiente", type: "int", value: (r) => r.filter((x) => x.canShip !== "Sí").length, better: "down" }
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
        title: "Monto pendiente por cliente",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "amount", label: "Monto pendiente" }],
        data: (rows) => groupSum(rows, "customer", ["amount"], { sortBy: "amount", top: 10 })
      }
    ]
  },
  {
    code: "DELIVERY_PERFORMANCE",
    name: "Cumplimiento de entregas",
    description: "Órdenes de venta con fecha pedida en el rango: si se despacharon completas y a tiempo (OTIF), con los días de atraso.",
    group: "Ventas",
    module: "SAL_ORDERS",
    ranged: true,
    columns: [
      { key: "requestedDate", header: "Fecha pedida", type: "date" },
      { key: "order", header: "OV", type: "text", width: 16 },
      { key: "customer", header: "Cliente", type: "text", width: 30 },
      { key: "lines", header: "Líneas", type: "int" },
      { key: "fillRate", header: "Despachado", type: "pct" },
      { key: "lastDelivery", header: "Último despacho", type: "date" },
      { key: "daysLate", header: "Días de atraso", type: "int" },
      { key: "result", header: "Resultado", type: "text", width: 22 },
      { key: "amount", header: "Monto OV", type: "money", total: true }
    ],
    rows: async ({ access, userId, from, to }) =>
      (
        await query<Row>(
          `SELECT to_char(COALESCE(so.requested_date, so.order_date), 'YYYY-MM-DD') AS "requestedDate", so.number AS "order",
                  COALESCE(c.trade_name, c.legal_name) AS customer,
                  (SELECT COUNT(*) FROM sales_orders_details d WHERE d.sales_order_id = so.id)::int AS lines,
                  (SELECT AVG(LEAST(d.quantity_delivered / NULLIF(d.quantity, 0), 1)) FROM sales_orders_details d WHERE d.sales_order_id = so.id)::float AS "fillRate",
                  (SELECT bool_and(d.quantity_delivered >= d.quantity) FROM sales_orders_details d WHERE d.sales_order_id = so.id) AS complete,
                  to_char((SELECT MAX(n.delivery_date) FROM delivery_notes n WHERE n.sales_order_id = so.id AND n.status = 'posted'), 'YYYY-MM-DD') AS "lastDelivery",
                  (so.taxable_amount * so.exchange_rate)::float AS amount, fn_rate_on('USD', so.order_date)::float AS _usd,
                  (CURRENT_DATE - COALESCE(so.requested_date, so.order_date))::int AS _age
             FROM sales_orders so JOIN customers c ON c.id = so.customer_id
            WHERE so.status NOT IN ('draft', 'pending_approval', 'cancelled')
              AND COALESCE(so.requested_date, so.order_date) BETWEEN $1 AND $2
              AND ($3::uuid IS NULL OR so.created_by = $3)
            ORDER BY 1, so.number`,
          [from, to, ownerScopeOf(access, "SAL_ORDERS", userId)]
        )
      ).map(({ complete, ...r }) => {
        const req = String(r.requestedDate);
        const last = r.lastDelivery ? String(r.lastDelivery) : null;
        // Sin completar, el atraso corre hasta hoy
        const late = complete && last ? Math.max(0, daysIn(req, last) - 1) : Math.max(0, Number(r._age));
        const onTime = complete && last !== null && last <= req;
        return {
          ...r,
          daysLate: late,
          result: onTime ? "Completa y a tiempo" : complete ? "Completa con atraso" : late > 0 ? "Incompleta y atrasada" : "Incompleta, en plazo",
          _otif: onTime ? 1 : 0,
          _complete: complete ? 1 : 0
        };
      }),
    kpis: [
      { key: "orders", label: "OV con entrega en el rango", type: "int", value: (r) => r.length },
      { key: "otif", label: "Completas y a tiempo", type: "pct", value: (r) => ratio(sum(r, "_otif"), r.length), better: "up", help: "OTIF: despachadas completas a más tardar en la fecha pedida" },
      { key: "complete", label: "Completas", type: "pct", value: (r) => ratio(sum(r, "_complete"), r.length), better: "up" },
      { key: "fill", label: "Despachado promedio", type: "pct", value: (r) => ratio(sum(r, "fillRate"), r.length), better: "up", help: "Promedio por línea de lo despachado sobre lo pedido" },
      {
        key: "late",
        label: "Atraso promedio (días)",
        type: "qty",
        value: (r) => {
          const l = r.filter((x) => Number(x.daysLate) > 0);
          return l.length ? Math.round((sum(l, "daysLate") / l.length) * 10) / 10 : 0;
        },
        better: "down",
        help: "Entre las OV que se atrasaron"
      }
    ],
    charts: [
      {
        title: "Resultado de las entregas",
        kind: "donut",
        type: "int",
        series: [{ key: "n", label: "OV" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, n: 1 })), "result", ["n"], { sortBy: "n" })
      }
    ]
  }
];
