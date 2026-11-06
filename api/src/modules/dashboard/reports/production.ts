/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/production.ts
 * @description Reportes de producción y calidad: eficiencia, variación de costos por componente,
 * consumo real contra teórico, calidad de lotes y carga de trabajo de las próximas dos semanas
 *
 * @overview
 * Eficiencia, costos y consumo miran las OP terminadas (confirmadas o cerradas) en el rango. La
 * cantidad requerida de cada material es para la cantidad PLANIFICADA; el consumo teórico se escala
 * a lo realmente fabricado para no castigar una OP que produjo menos.
 */

import { query } from "../../../db.js";
import { type ReportDef, type Row, groupSum, ratio, sum, sumUsd, usdOf } from "./types.js";

/** Días hacia adelante que mira la carga de trabajo */
const LOAD_DAYS = 14;

const STATUS_LABEL: Record<string, string> = {
  planned: "Planificada",
  created: "Creada",
  released: "Liberada",
  in_process: "En proceso",
  confirmed: "Confirmada",
  closed: "Cerrada"
};

/** OP terminadas en el rango, con su costo estándar escalado a lo fabricado */
const DONE_ORDERS = `
  SELECT o.*, p.code AS product_code, p.name AS product_name, u.code AS unit, o.confirmed_at::date AS done_on,
         CASE WHEN o.quantity_planned > 0 THEN o.quantity_produced / o.quantity_planned ELSE 0 END AS scale,
         fn_rate_on('USD', o.confirmed_at::date) AS usd
    FROM production_orders o
    JOIN products p ON p.id = o.product_id
    JOIN catalogs_units u ON u.id = p.stock_unit_id
   WHERE o.status IN ('confirmed', 'closed') AND o.confirmed_at::date BETWEEN $1 AND $2`;

const QC_LABEL: Record<string, string> = { approved: "Aprobado", rejected: "Rechazado", on_hold: "Retenido", quarantine: "Cuarentena" };

export const PRODUCTION_REPORTS: ReportDef[] = [
  {
    code: "PRODUCTION_EFFICIENCY",
    name: "Eficiencia de producción",
    description: "OP terminadas en el rango: fabricado contra planificado, consumo de materiales contra la fórmula y cumplimiento de la fecha.",
    group: "Producción",
    module: "PRD_ORDERS",
    ranged: true,
    columns: [
      { key: "number", header: "OP", type: "text", width: 16 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "planned", header: "Planificado", type: "qty" },
      { key: "produced", header: "Fabricado", type: "qty" },
      { key: "yield", header: "Rendimiento", type: "pct" },
      { key: "materialStd", header: "Materiales según fórmula", type: "money", total: true },
      { key: "materialReal", header: "Materiales consumidos", type: "money", total: true },
      { key: "materialDiff", header: "Sobreconsumo", type: "pct" },
      { key: "plannedEnd", header: "Fin planificado", type: "date" },
      { key: "doneOn", header: "Terminada", type: "date" },
      { key: "daysLate", header: "Días de atraso", type: "int" }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT o.number, o.product_code AS "productCode", o.product_name AS "productName", o.unit,
                  o.quantity_planned::float AS planned, o.quantity_produced::float AS produced,
                  (o.std_material_cost * o.scale)::float AS "materialStd", o.real_material_cost::float AS "materialReal",
                  to_char(COALESCE(o.planned_end, o.planned_start), 'YYYY-MM-DD') AS "plannedEnd", to_char(o.done_on, 'YYYY-MM-DD') AS "doneOn",
                  GREATEST(o.done_on - COALESCE(o.planned_end, o.planned_start), 0)::int AS "daysLate", o.usd::float AS _usd
             FROM (${DONE_ORDERS}) o ORDER BY o.done_on, o.number`,
          [from, to]
        )
      ).map((r) => ({
        ...r,
        yield: ratio(Number(r.produced), Number(r.planned)),
        materialDiff: ratio(Number(r.materialReal) - Number(r.materialStd), Number(r.materialStd))
      })),
    kpis: [
      { key: "orders", label: "OP terminadas", type: "int", value: (r) => r.length, better: "up" },
      { key: "yield", label: "Rendimiento promedio", type: "pct", value: (r) => (r.length ? sum(r, "yield") / r.length : null), better: "up", help: "Fabricado sobre planificado, promedio de las OP" },
      {
        key: "onTime",
        label: "A tiempo",
        type: "pct",
        value: (r) => ratio(r.filter((x) => Number(x.daysLate) === 0).length, r.length),
        better: "up"
      },
      {
        key: "material",
        label: "Sobreconsumo de materiales",
        type: "pct",
        value: (r) => ratio(sum(r, "materialReal") - sum(r, "materialStd"), sum(r, "materialStd")),
        better: "down",
        help: "Costo consumido contra el de la fórmula para lo fabricado"
      }
    ],
    charts: [
      {
        title: "Rendimiento por producto",
        kind: "bar",
        type: "pct",
        horizontal: true,
        series: [{ key: "yield", label: "Rendimiento" }],
        data: (rows) =>
          groupSum(rows, "productName", ["produced", "planned"])
            .map((p) => ({ label: p.label, yield: Math.round((ratio(Number(p.produced), Number(p.planned)) ?? 0) * 1000) / 1000 }))
            .sort((a, b) => a.yield - b.yield)
            .slice(0, 12)
      }
    ]
  },
  {
    code: "PRODUCTION_COST_VARIANCE",
    name: "Variación de costos de producción",
    description: "Costo real contra estándar de cada OP terminada, separado en materiales, mano de obra y gastos indirectos.",
    group: "Producción",
    module: "PRD_ORDERS",
    ranged: true,
    columns: [
      { key: "number", header: "OP", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "produced", header: "Fabricado", type: "qty" },
      { key: "stdMaterial", header: "Materiales estándar", type: "money", total: true },
      { key: "realMaterial", header: "Materiales real", type: "money", total: true },
      { key: "stdLabor", header: "Mano de obra estándar", type: "money", total: true },
      { key: "realLabor", header: "Mano de obra real", type: "money", total: true },
      { key: "stdOverhead", header: "Indirectos estándar", type: "money", total: true },
      { key: "realOverhead", header: "Indirectos real", type: "money", total: true },
      { key: "variance", header: "Variación total", type: "money", total: true },
      { key: "varianceUsd", header: "Variación USD", type: "money", usd: true, total: true },
      { key: "variancePct", header: "Variación %", type: "pct" },
      { key: "unitCost", header: "Costo unitario real", type: "money" }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT o.number, o.product_name AS "productName", o.quantity_produced::float AS produced,
                  (o.std_material_cost * o.scale)::float AS "stdMaterial", o.real_material_cost::float AS "realMaterial",
                  (o.std_labor_cost * o.scale)::float AS "stdLabor", o.real_labor_cost::float AS "realLabor",
                  (o.std_overhead_cost * o.scale)::float AS "stdOverhead", o.real_overhead_cost::float AS "realOverhead",
                  o.real_unit_cost::float AS "unitCost", o.usd::float AS _usd
             FROM (${DONE_ORDERS}) o ORDER BY o.done_on, o.number`,
          [from, to]
        )
      ).map((r) => {
        const std = Number(r.stdMaterial) + Number(r.stdLabor) + Number(r.stdOverhead);
        const real = Number(r.realMaterial) + Number(r.realLabor) + Number(r.realOverhead);
        return { ...r, variance: real - std, varianceUsd: usdOf(real - std, r._usd), variancePct: ratio(real - std, std), _std: std, _real: real };
      }),
    kpis: [
      { key: "std", label: "Costo estándar", type: "money", value: (r) => sum(r, "_std"), usd: (r) => sumUsd(r, "_std") },
      { key: "real", label: "Costo real", type: "money", value: (r) => sum(r, "_real"), usd: (r) => sumUsd(r, "_real") },
      { key: "variance", label: "Variación", type: "money", value: (r) => sum(r, "variance"), usd: (r) => sumUsd(r, "variance"), better: "down", help: "Positiva: costó más de lo previsto" },
      { key: "variancePct", label: "Variación %", type: "pct", value: (r) => ratio(sum(r, "variance"), sum(r, "_std")), better: "down" }
    ],
    charts: [
      {
        title: "Estándar contra real por componente",
        kind: "bar",
        type: "money",
        series: [
          { key: "std", label: "Estándar" },
          { key: "real", label: "Real" }
        ],
        data: (rows) => [
          { label: "Materiales", std: sum(rows, "stdMaterial"), real: sum(rows, "realMaterial") },
          { label: "Mano de obra", std: sum(rows, "stdLabor"), real: sum(rows, "realLabor") },
          { label: "Indirectos", std: sum(rows, "stdOverhead"), real: sum(rows, "realOverhead") }
        ]
      }
    ]
  },
  {
    code: "MATERIAL_CONSUMPTION",
    name: "Consumo de materiales",
    description: "Por materia prima, en las OP terminadas: consumo real contra el teórico de la fórmula para lo fabricado, en cantidad y costo.",
    group: "Producción",
    module: "PRD_ORDERS",
    ranged: true,
    columns: [
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Material", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "orders", header: "OP", type: "int" },
      { key: "theoretical", header: "Teórico", type: "qty" },
      { key: "consumed", header: "Real", type: "qty" },
      { key: "diff", header: "Diferencia", type: "qty" },
      { key: "diffPct", header: "Diferencia %", type: "pct" },
      { key: "stdCost", header: "Costo teórico", type: "money", total: true },
      { key: "realCost", header: "Costo real", type: "money", total: true },
      { key: "costDiff", header: "Diferencia de costo", type: "money", total: true },
      { key: "costDiffUsd", header: "Diferencia USD", type: "money", usd: true, total: true }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT p.code AS "productCode", p.name AS "productName", u.code AS unit, COUNT(DISTINCT o.id)::int AS orders,
                  SUM(d.quantity_required * o.scale)::float AS theoretical, SUM(d.quantity_consumed)::float AS consumed,
                  SUM(d.quantity_required * o.scale * d.std_unit_cost)::float AS "stdCost", SUM(d.consumed_cost)::float AS "realCost",
                  fn_rate_on('USD', $2::date)::float AS _usd
             FROM (${DONE_ORDERS}) o
             JOIN production_orders_details d ON d.production_order_id = o.id
             JOIN products p ON p.id = d.product_id
             JOIN catalogs_units u ON u.id = p.stock_unit_id
            GROUP BY p.id, p.code, p.name, u.code`,
          [from, to]
        )
      )
        .map((r) => {
          const diff = Number(r.consumed) - Number(r.theoretical);
          const costDiff = Number(r.realCost) - Number(r.stdCost);
          return { ...r, diff, diffPct: ratio(diff, Number(r.theoretical)), costDiff, costDiffUsd: usdOf(costDiff, r._usd) };
        })
        .sort((a, b) => b.costDiff - a.costDiff),
    kpis: [
      { key: "materials", label: "Materiales", type: "int", value: (r) => r.length },
      { key: "over", label: "Con sobreconsumo", type: "int", value: (r) => r.filter((x) => Number(x.diffPct) > 0.005).length, better: "down" },
      { key: "costDiff", label: "Diferencia de costo", type: "money", value: (r) => sum(r, "costDiff"), usd: (r) => sumUsd(r, "costDiff"), better: "down" },
      { key: "costDiffPct", label: "Diferencia %", type: "pct", value: (r) => ratio(sum(r, "costDiff"), sum(r, "stdCost")), better: "down" }
    ],
    charts: [
      {
        title: "Diferencia de costo por material",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "costDiff", label: "Diferencia de costo" }],
        data: (rows) => rows.filter((r) => Math.abs(Number(r.costDiff)) >= 0.01).slice(0, 12).map((r) => ({ label: String(r.productName), costDiff: Math.round(Number(r.costDiff) * 100) / 100 }))
      }
    ]
  },
  {
    code: "LOT_QUALITY",
    name: "Calidad de lotes",
    description: "Lotes con decisión de calidad en el rango: aprobados, rechazados y retenidos, cuánto estuvieron en cuarentena y de qué proveedor u OP venían.",
    group: "Producción",
    module: "QC_LOTS",
    ranged: true,
    columns: [
      { key: "decidedAt", header: "Decisión", type: "datetime" },
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 32 },
      { key: "origin", header: "Origen", type: "text", width: 30 },
      { key: "decision", header: "Resultado", type: "text", width: 12 },
      { key: "hours", header: "Horas en cuarentena", type: "qty" },
      { key: "analysisRef", header: "Análisis", type: "text", width: 16 },
      { key: "notes", header: "Observación", type: "text", width: 36 },
      { key: "decidedBy", header: "Decidió", type: "text", width: 22 }
    ],
    rows: async ({ from, to }) =>
      (
        await query<Row>(
          `SELECT DISTINCT ON (l.id) to_char(e.decided_at, 'YYYY-MM-DD HH24:MI') AS "decidedAt", l.lot_code AS "lotCode",
                  p.code AS "productCode", p.name AS "productName",
                  CASE WHEN s.id IS NOT NULL THEN 'Proveedor · ' || COALESCE(s.trade_name, s.legal_name)
                       WHEN o.id IS NOT NULL THEN 'Producción · ' || o.number ELSE 'Otro' END AS origin,
                  e.to_status AS _status, round((extract(epoch FROM e.decided_at - l.created_at) / 3600)::numeric, 1)::float AS hours,
                  e.analysis_ref AS "analysisRef", e.notes, u.names AS "decidedBy"
             FROM lots_quality_events e
             JOIN lots l ON l.id = e.lot_id
             JOIN products p ON p.id = l.product_id
             LEFT JOIN suppliers s ON s.id = l.supplier_id
             LEFT JOIN production_orders o ON o.id = l.production_order_id
             LEFT JOIN users u ON u.id = e.decided_by
            WHERE e.to_status IN ('approved', 'rejected', 'on_hold') AND e.decided_at::date BETWEEN $1 AND $2
            ORDER BY l.id, e.decided_at DESC`,
          [from, to]
        )
      )
        .map((r) => ({ ...r, decision: QC_LABEL[String(r._status)] ?? r._status }))
        .sort((a: Row, b: Row) => String(a.decidedAt).localeCompare(String(b.decidedAt))),
    kpis: [
      { key: "lots", label: "Lotes decididos", type: "int", value: (r) => r.length },
      { key: "approved", label: "Aprobados", type: "pct", value: (r) => ratio(r.filter((x) => x._status === "approved").length, r.length), better: "up" },
      { key: "rejected", label: "Rechazados", type: "pct", value: (r) => ratio(r.filter((x) => x._status === "rejected").length, r.length), better: "down" },
      { key: "hours", label: "Horas en cuarentena (promedio)", type: "qty", value: (r) => (r.length ? Math.round((sum(r, "hours") / r.length) * 10) / 10 : null), better: "down" }
    ],
    charts: [
      {
        title: "Resultado de calidad",
        kind: "donut",
        type: "int",
        series: [{ key: "n", label: "Lotes" }],
        data: (rows) => groupSum(rows.map((r) => ({ ...r, n: 1 })), "decision", ["n"], { sortBy: "n" })
      },
      {
        title: "Lotes rechazados por origen",
        kind: "bar",
        type: "int",
        horizontal: true,
        series: [{ key: "n", label: "Rechazados" }],
        data: (rows) => groupSum(rows.filter((r) => r._status === "rejected").map((r) => ({ ...r, n: 1 })), "origin", ["n"], { sortBy: "n", top: 10 })
      }
    ]
  },
  {
    code: "PRODUCTION_LOAD",
    name: "Carga de trabajo próxima",
    description: `OP abiertas que empiezan en los próximos ${LOAD_DAYS} días (o ya debían empezar): cantidad por fabricar y materiales que no alcanzan en su almacén.`,
    group: "Producción",
    module: "PRD_ORDERS",
    ranged: false,
    columns: [
      { key: "plannedStart", header: "Inicio", type: "date" },
      { key: "plannedEnd", header: "Fin", type: "date" },
      { key: "number", header: "OP", type: "text", width: 16 },
      { key: "status", header: "Estado", type: "text", width: 12 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 32 },
      { key: "pending", header: "Por fabricar", type: "qty" },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "timing", header: "Plazo", type: "text", width: 14 },
      { key: "materials", header: "Materiales", type: "int" },
      { key: "missing", header: "Faltantes", type: "int", total: true },
      { key: "missingList", header: "Materiales que faltan", type: "text", width: 50 }
    ],
    rows: async () =>
      (
        await query<Row>(
          `WITH need AS (
             SELECT d.production_order_id, d.product_id, p.code, GREATEST(d.quantity_required - d.quantity_consumed, 0) AS need,
                    COALESCE((SELECT SUM(b.quantity - b.reserved) FROM stock_balances b
                               WHERE b.warehouse_id = COALESCE(d.warehouse_id, o.materials_warehouse_id) AND b.product_id = d.product_id), 0) AS avail
               FROM production_orders_details d JOIN production_orders o ON o.id = d.production_order_id JOIN products p ON p.id = d.product_id
              WHERE o.status IN ('planned', 'created', 'released', 'in_process')
           )
           SELECT to_char(o.planned_start, 'YYYY-MM-DD') AS "plannedStart", to_char(o.planned_end, 'YYYY-MM-DD') AS "plannedEnd",
                  o.number, o.status AS _status, p.code AS "productCode", p.name AS "productName",
                  GREATEST(o.quantity_planned - o.quantity_produced, 0)::float AS pending, u.code AS unit,
                  (o.planned_start < CURRENT_DATE) AS _overdue,
                  (SELECT COUNT(*) FROM need n WHERE n.production_order_id = o.id)::int AS materials,
                  (SELECT COUNT(*) FROM need n WHERE n.production_order_id = o.id AND n.need > n.avail)::int AS missing,
                  (SELECT string_agg(n.code, ', ' ORDER BY n.code) FROM need n WHERE n.production_order_id = o.id AND n.need > n.avail) AS "missingList"
             FROM production_orders o JOIN products p ON p.id = o.product_id JOIN catalogs_units u ON u.id = p.stock_unit_id
            WHERE o.status IN ('planned', 'created', 'released', 'in_process') AND o.planned_start <= CURRENT_DATE + $1::int
            ORDER BY o.planned_start, o.priority, o.number`,
          [LOAD_DAYS]
        )
      ).map((r) => ({
        ...r,
        status: STATUS_LABEL[String(r._status)] ?? r._status,
        timing: r._overdue && r._status !== "in_process" ? "Atrasada" : r._status === "in_process" ? "En curso" : "Por iniciar"
      })),
    kpis: [
      { key: "orders", label: "OP en el horizonte", type: "int", value: (r) => r.length },
      { key: "late", label: "Atrasadas", type: "int", value: (r) => r.filter((x) => x.timing === "Atrasada").length, better: "down" },
      { key: "short", label: "OP con faltantes", type: "int", value: (r) => r.filter((x) => Number(x.missing) > 0).length, better: "down" },
      {
        key: "materials",
        label: "Materiales faltantes",
        type: "int",
        value: (r) => new Set(r.flatMap((x) => (x.missingList ? String(x.missingList).split(", ") : []))).size,
        help: "Materias primas distintas que no alcanzan para alguna OP"
      }
    ],
    charts: [
      {
        title: "OP por fecha de inicio",
        kind: "bar",
        type: "int",
        series: [
          { key: "ok", label: "Con materiales" },
          { key: "short", label: "Con faltantes" }
        ],
        data: (rows) =>
          groupSum(
            rows.map((r) => ({ ...r, ok: Number(r.missing) > 0 ? 0 : 1, short: Number(r.missing) > 0 ? 1 : 0, day: r._overdue ? "Atrasadas" : `${String(r.plannedStart).slice(8, 10)}/${String(r.plannedStart).slice(5, 7)}` })),
            "day",
            ["ok", "short"]
          )
      }
    ]
  }
];
