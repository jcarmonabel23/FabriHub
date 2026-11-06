/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports.ts
 * @description Reportes gerenciales en Excel (DSH_REPORTS)
 *
 * @overview
 * El Excel se arma en el SERVIDOR (exceljs), no en el navegador: así el permiso `download` y el
 * alcance de datos se aplican donde no se pueden saltar, y el archivo sale con formato (títulos,
 * filtros, totales, formatos numéricos y de fecha).
 * Para ver o descargar un reporte hace falta `download` en Reportes y `view` en el módulo de origen;
 * las filas se acotan igual que en esa pantalla (almacenes asignados, órdenes propias).
 * Cada reporte puede traer un resumen (indicadores comparados con el período anterior y gráficos,
 * ver reports/types.ts) que la vista previa muestra y el Excel lleva en su primera hoja.
 * Los reportes de ventas, caja e inventario para el día a día están en reports/.
 */

import ExcelJS from "exceljs";
import { z } from "zod";
import { one, query } from "../../db.js";
import { badRequest, forbidden, handler, notFound } from "../../lib/http.js";
import { authOf } from "../../security/context.js";
import { companyBranding, type Branding } from "../settings/branding.js";
import { ALERT_KINDS } from "./alerts.js";
import { type ModuleAccess, alertVisibleTo, canView, moduleAccess, ownerScopeOf, warehouseScopeOf } from "./access.js";
import { CUSTOMER_REPORTS } from "./reports/customers.js";
import { FISCAL_REPORTS } from "./reports/fiscal.js";
import { INVENTORY_REPORTS } from "./reports/inventory.js";
import { MANAGEMENT_REPORTS } from "./reports/management.js";
import { POS_REPORTS } from "./reports/pos.js";
import { PRODUCTION_REPORTS } from "./reports/production.js";
import { PURCHASE_REPORTS } from "./reports/purchases.js";
import { SALES_ANALYSIS_REPORTS } from "./reports/salesAnalysis.js";
import { SALES_REPORTS } from "./reports/sales.js";
import { STOCK_FLOW_REPORTS } from "./reports/stockFlows.js";
import {
  type ChartDef,
  type ChartPoint,
  type ColType,
  type Column,
  type Ctx,
  type ReportDef,
  type Row,
  REPORT_GROUPS,
  distinct,
  groupSum,
  previousRange,
  ratio,
  sum,
  sumUsd
} from "./reports/types.js";

const KIND_LABEL: Record<(typeof ALERT_KINDS)[number], string> = {
  STOCK_MIN: "Stock bajo el mínimo",
  STOCK_MAX: "Stock sobre el máximo",
  LOT_EXPIRING: "Lote por vencer",
  LOT_EXPIRED: "Lote vencido",
  QC_PENDING: "Cuarentena prolongada",
  PO_OVERDUE: "OC atrasada",
  PRO_LATE: "OP atrasada",
  SO_LATE: "OV atrasada",
  RATES_FAILED: "Tasa de cambio sin actualizar",
  EINV_FAILED: "Comprobantes electrónicos con problemas",
  FISCAL_PENDING: "Documentos fiscales pendientes"
};
const SEVERITY_LABEL: Record<string, string> = { critical: "Crítica", warning: "Advertencia", info: "Aviso" };
const QC_LABEL: Record<string, string> = { quarantine: "Cuarentena", approved: "Aprobado", rejected: "Rechazado", on_hold: "Retenido" };

/** Reportes anteriores al bloque del día a día; su resumen se agrega en EXTRAS */
const BASE_REPORTS: Omit<ReportDef, "group">[] = [
  {
    code: "STOCK_VALUED",
    name: "Existencias valoradas",
    description: "Existencia, reservado y disponible por almacén, producto y lote, al costo promedio.",
    module: "INV_STOCK",
    ranged: false,
    columns: [
      { key: "warehouse", header: "Almacén", type: "text", width: 22 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 38 },
      { key: "productType", header: "Tipo", type: "text", width: 20 },
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "expiresOn", header: "Vence", type: "date" },
      { key: "qualityStatus", header: "Calidad", type: "text", width: 13 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "quantity", header: "Existencia", type: "qty" },
      { key: "reserved", header: "Reservado", type: "qty" },
      { key: "available", header: "Disponible", type: "qty" },
      { key: "avgCost", header: "Costo promedio", type: "money" },
      { key: "value", header: "Valor", type: "money", total: true }
    ],
    rows: async ({ access }) =>
      query(
        `SELECT w.code || ' · ' || w.name AS warehouse, p.code AS "productCode", p.name AS "productName", t.name AS "productType",
                l.lot_code AS "lotCode", l.expires_on AS "expiresOn", l.quality_status AS "qualityStatus", u.code AS unit,
                b.quantity::float AS quantity, b.reserved::float AS reserved, (b.quantity - b.reserved)::float AS available,
                CASE WHEN v.quantity > 0 THEN (v.total_value / v.quantity)::float ELSE 0 END AS "avgCost",
                (b.quantity * CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE 0 END)::float AS value,
                fn_rate_on('USD', CURRENT_DATE)::float AS _usd
           FROM stock_balances b
           JOIN warehouses w ON w.id = b.warehouse_id
           JOIN products p ON p.id = b.product_id
           JOIN catalogs_product_types t ON t.id = p.product_type_id
           JOIN catalogs_units u ON u.id = p.stock_unit_id
           LEFT JOIN lots l ON l.id = b.lot_id
           LEFT JOIN stock_valuation v ON v.warehouse_id = b.warehouse_id AND v.product_id = b.product_id
          WHERE b.quantity <> 0 AND ($1::uuid[] IS NULL OR b.warehouse_id = ANY($1))
          ORDER BY w.order_list, p.code, l.expires_on NULLS LAST`,
        [warehouseScopeOf(access, "INV_STOCK")]
      )
  },
  {
    code: "LOTS_EXPIRY",
    name: "Vencimiento de lotes",
    description: "Lotes con existencia ordenados por fecha de vencimiento (FEFO), con días restantes y estado de calidad.",
    module: "INV_LOTS",
    ranged: false,
    columns: [
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 38 },
      { key: "expiresOn", header: "Vence", type: "date" },
      { key: "daysLeft", header: "Días restantes", type: "int" },
      { key: "qualityStatus", header: "Calidad", type: "text", width: 13 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "quantity", header: "Existencia", type: "qty" },
      { key: "value", header: "Valor", type: "money", total: true }
    ],
    rows: async () =>
      query(
        `SELECT l.lot_code AS "lotCode", p.code AS "productCode", p.name AS "productName", l.expires_on AS "expiresOn",
                (l.expires_on - CURRENT_DATE)::int AS "daysLeft", l.quality_status AS "qualityStatus", u.code AS unit,
                s.quantity::float AS quantity, s.value::float AS value, fn_rate_on('USD', CURRENT_DATE)::float AS _usd
           FROM lots l
           JOIN products p ON p.id = l.product_id
           JOIN catalogs_units u ON u.id = p.stock_unit_id
           JOIN (SELECT b.lot_id, SUM(b.quantity) AS quantity,
                        SUM(b.quantity * CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE 0 END) AS value
                   FROM stock_balances b
                   LEFT JOIN stock_valuation v ON v.warehouse_id = b.warehouse_id AND v.product_id = b.product_id
                  WHERE b.lot_id IS NOT NULL GROUP BY b.lot_id HAVING SUM(b.quantity) > 0) s ON s.lot_id = l.id
          ORDER BY l.expires_on NULLS LAST, p.code`
      )
  },
  {
    code: "MOVEMENTS",
    name: "Movimientos de inventario",
    description: "Líneas de entradas, salidas y traslados contabilizados en el rango, con su costo.",
    module: "INV_MOVEMENTS",
    ranged: true,
    columns: [
      { key: "movementDate", header: "Fecha", type: "date" },
      { key: "number", header: "Número", type: "text", width: 16 },
      { key: "concept", header: "Concepto", type: "text", width: 26 },
      { key: "direction", header: "Sentido", type: "text", width: 10 },
      { key: "warehouse", header: "Almacén", type: "text", width: 14 },
      { key: "target", header: "Destino", type: "text", width: 14 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "quantity", header: "Cantidad", type: "qty" },
      { key: "unitCost", header: "Costo unitario", type: "money" },
      { key: "totalCost", header: "Costo total", type: "money", total: true },
      { key: "status", header: "Estado", type: "text", width: 11 },
      { key: "reference", header: "Referencia", type: "text", width: 20 }
    ],
    rows: async ({ access, from, to }) =>
      query(
        `SELECT m.movement_date AS "movementDate", m.number, c.name AS concept,
                CASE m.direction WHEN 'in' THEN 'Entrada' WHEN 'out' THEN 'Salida' ELSE 'Traslado' END AS direction,
                w.code AS warehouse, tw.code AS target, p.code AS "productCode", p.name AS "productName", l.lot_code AS "lotCode",
                d.quantity::float AS quantity, d.unit_cost::float AS "unitCost", d.total_cost::float AS "totalCost",
                CASE m.status WHEN 'reversed' THEN 'Reversado' ELSE 'Contabilizado' END AS status, m.reference,
                fn_rate_on('USD', m.movement_date)::float AS _usd
           FROM inventory_movements_details d
           JOIN inventory_movements m ON m.id = d.movement_id
           JOIN catalogs_movement_concepts c ON c.id = m.concept_id
           JOIN warehouses w ON w.id = m.warehouse_id
           LEFT JOIN warehouses tw ON tw.id = m.target_warehouse_id
           JOIN products p ON p.id = d.product_id
           LEFT JOIN lots l ON l.id = d.lot_id
          WHERE m.status <> 'draft' AND m.movement_date BETWEEN $2 AND $3
            AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1) OR m.target_warehouse_id = ANY($1))
          ORDER BY m.movement_date, m.number, d.line_no`,
        [warehouseScopeOf(access, "INV_MOVEMENTS"), from, to]
      )
  },
  {
    code: "PURCHASES",
    name: "Compras por proveedor",
    description: "Líneas de órdenes de compra emitidas en el rango: pedido, recibido, pendiente y monto en moneda base.",
    module: "PUR_ORDERS",
    ranged: true,
    columns: [
      { key: "orderDate", header: "Fecha", type: "date" },
      { key: "number", header: "OC", type: "text", width: 16 },
      { key: "status", header: "Estado", type: "text", width: 16 },
      { key: "supplier", header: "Proveedor", type: "text", width: 30 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "quantity", header: "Pedido", type: "qty" },
      { key: "received", header: "Recibido", type: "qty" },
      { key: "pending", header: "Pendiente", type: "qty" },
      { key: "expectedDate", header: "Esperada", type: "date" },
      { key: "currency", header: "Moneda", type: "text", width: 8 },
      { key: "netAmount", header: "Neto (moneda OC)", type: "money", currencyKey: "currency" },
      { key: "netBase", header: "Neto (moneda base)", type: "money", total: true }
    ],
    rows: async ({ from, to }) =>
      query(
        `SELECT po.order_date AS "orderDate", po.number,
                CASE po.status WHEN 'draft' THEN 'Borrador' WHEN 'pending_approval' THEN 'Por aprobar' WHEN 'approved' THEN 'Aprobada'
                     WHEN 'partially_received' THEN 'Recibida en parte' WHEN 'received' THEN 'Recibida' WHEN 'closed' THEN 'Cerrada'
                     ELSE 'Anulada' END AS status,
                COALESCE(s.trade_name, s.legal_name) AS supplier, p.code AS "productCode", p.name AS "productName", u.code AS unit,
                d.quantity::float AS quantity, d.quantity_received::float AS received, GREATEST(d.quantity - d.quantity_received, 0)::float AS pending,
                COALESCE(d.expected_date, po.expected_date) AS "expectedDate", c.code AS currency,
                d.net_amount::float AS "netAmount", (d.net_amount * po.exchange_rate)::float AS "netBase",
                fn_rate_on('USD', po.order_date)::float AS _usd
           FROM purchase_orders_details d
           JOIN purchase_orders po ON po.id = d.purchase_order_id
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN products p ON p.id = d.product_id
           JOIN catalogs_units u ON u.id = d.unit_id
           JOIN catalogs_currencies c ON c.id = po.currency_id
          WHERE po.order_date BETWEEN $1 AND $2 AND po.status <> 'cancelled'
          ORDER BY supplier, po.order_date, po.number, d.line_no`,
        [from, to]
      )
  },
  {
    code: "SALES",
    name: "Despachos de pedidos y margen",
    description: "Líneas de notas de entrega contabilizadas en el rango: venta neta de descuentos en moneda base, costo y margen por lote.",
    module: "SAL_ORDERS",
    ranged: true,
    columns: [
      { key: "deliveryDate", header: "Fecha", type: "date" },
      { key: "note", header: "Nota de entrega", type: "text", width: 16 },
      { key: "order", header: "OV", type: "text", width: 16 },
      { key: "customer", header: "Cliente", type: "text", width: 30 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "quantity", header: "Cantidad (inv.)", type: "qty", total: true },
      { key: "sales", header: "Venta neta", type: "money", total: true },
      { key: "cost", header: "Costo", type: "money", total: true },
      { key: "margin", header: "Margen", type: "money", total: true },
      { key: "marginPct", header: "Margen %", type: "pct" }
    ],
    rows: async ({ access, userId, from, to }) =>
      query(
        `SELECT x.*, (x.sales - x.cost) AS margin, CASE WHEN x.sales > 0 THEN (x.sales - x.cost) / x.sales END AS "marginPct"
           FROM (SELECT n.delivery_date AS "deliveryDate", n.number AS note, so.number AS "order",
                        COALESCE(c.trade_name, c.legal_name) AS customer, p.code AS "productCode", p.name AS "productName",
                        l.lot_code AS "lotCode", d.stock_quantity::float AS quantity,
                        (d.quantity * COALESCE(sod.net_amount / NULLIF(sod.quantity, 0), d.unit_price) * so.exchange_rate)::float AS sales,
                        (d.stock_quantity * COALESCE(d.unit_cost, 0))::float AS cost, d.line_no,
                        fn_rate_on('USD', n.delivery_date)::float AS _usd
                   FROM delivery_notes_details d
                   JOIN delivery_notes n ON n.id = d.delivery_note_id
                   JOIN sales_orders so ON so.id = n.sales_order_id
                   LEFT JOIN sales_orders_details sod ON sod.id = d.so_line_id
                   JOIN customers c ON c.id = so.customer_id
                   JOIN products p ON p.id = d.product_id
                   LEFT JOIN lots l ON l.id = d.lot_id
                  WHERE n.status = 'posted' AND n.delivery_date BETWEEN $2 AND $3
                    AND ($1::uuid IS NULL OR so.created_by = $1)) x
          ORDER BY x."deliveryDate", x.note, x.line_no`,
        [ownerScopeOf(access, "SAL_ORDERS", userId), from, to]
      ).then((rows) => rows.map(({ line_no: _l, ...r }) => r))
  },
  {
    code: "PRODUCTION",
    name: "Órdenes de producción y costos",
    description: "OP con inicio en el rango: cumplimiento de fechas y costo real contra estándar de lo fabricado.",
    module: "PRD_ORDERS",
    ranged: true,
    columns: [
      { key: "number", header: "OP", type: "text", width: 16 },
      { key: "status", header: "Estado", type: "text", width: 13 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "lotCode", header: "Lote", type: "text", width: 16 },
      { key: "plannedStart", header: "Inicio plan.", type: "date" },
      { key: "plannedEnd", header: "Fin plan.", type: "date" },
      { key: "confirmedOn", header: "Terminada", type: "date" },
      { key: "onTime", header: "A tiempo", type: "text", width: 9 },
      { key: "planned", header: "Planificado", type: "qty" },
      { key: "produced", header: "Producido", type: "qty" },
      { key: "stdCost", header: "Costo estándar", type: "money", total: true },
      { key: "realCost", header: "Costo real", type: "money", total: true },
      { key: "variance", header: "Variación", type: "money", total: true },
      { key: "variancePct", header: "Variación %", type: "pct" },
      { key: "realUnitCost", header: "Costo real unitario", type: "money" }
    ],
    rows: async ({ from, to }) =>
      query(
        `SELECT o.number,
                CASE o.status WHEN 'planned' THEN 'Planificada' WHEN 'created' THEN 'Creada' WHEN 'released' THEN 'Liberada'
                     WHEN 'in_process' THEN 'En proceso' WHEN 'confirmed' THEN 'Confirmada' WHEN 'closed' THEN 'Cerrada' ELSE 'Anulada' END AS status,
                p.code AS "productCode", p.name AS "productName", o.lot_code AS "lotCode",
                o.planned_start AS "plannedStart", o.planned_end AS "plannedEnd", o.confirmed_at::date AS "confirmedOn",
                CASE WHEN o.confirmed_at IS NULL THEN NULL
                     WHEN o.confirmed_at::date <= COALESCE(o.planned_end, o.planned_start) THEN 'Sí' ELSE 'No' END AS "onTime",
                o.quantity_planned::float AS planned, o.quantity_produced::float AS produced,
                ((o.std_material_cost + o.std_labor_cost + o.std_overhead_cost) * o.quantity_produced / o.quantity_planned)::float AS "stdCost",
                (o.real_material_cost + o.real_labor_cost + o.real_overhead_cost)::float AS "realCost",
                o.variance::float AS variance,
                (o.variance / NULLIF((o.std_material_cost + o.std_labor_cost + o.std_overhead_cost) * o.quantity_produced / o.quantity_planned, 0))::float AS "variancePct",
                o.real_unit_cost::float AS "realUnitCost"
           FROM production_orders o JOIN products p ON p.id = o.product_id
          WHERE o.planned_start BETWEEN $1 AND $2 AND o.status <> 'cancelled'
          ORDER BY o.planned_start, o.number`,
        [from, to]
      )
  },
  {
    code: "MRP",
    name: "Sugerencias del último MRP",
    description: "Órdenes sugeridas por la corrida más reciente del MRP: fabricar o comprar, fechas y documento generado.",
    module: "PRD_PLANNING",
    ranged: false,
    columns: [
      { key: "period", header: "Período", type: "text", width: 16 },
      { key: "runAt", header: "Corrida", type: "datetime" },
      { key: "kind", header: "Acción", type: "text", width: 10 },
      { key: "productCode", header: "Código", type: "text", width: 16 },
      { key: "productName", header: "Producto", type: "text", width: 34 },
      { key: "unit", header: "Unidad", type: "text", width: 9 },
      { key: "netQuantity", header: "Neta", type: "qty" },
      { key: "quantity", header: "Sugerida", type: "qty" },
      { key: "releaseDate", header: "Lanzar", type: "date" },
      { key: "dueDate", header: "Necesidad", type: "date" },
      { key: "late", header: "Atrasada", type: "text", width: 9 },
      { key: "supplier", header: "Proveedor", type: "text", width: 28 },
      { key: "status", header: "Estado", type: "text", width: 12 },
      { key: "document", header: "Documento", type: "text", width: 16 }
    ],
    rows: async () =>
      query(
        `WITH last AS (SELECT r.id, r.run_at, pp.code FROM mrp_runs r JOIN planning_periods pp ON pp.id = r.period_id ORDER BY r.run_at DESC LIMIT 1)
         SELECT last.code AS period, to_char(last.run_at, 'YYYY-MM-DD HH24:MI') AS "runAt", CASE s.kind WHEN 'make' THEN 'Fabricar' ELSE 'Comprar' END AS kind,
                p.code AS "productCode", p.name AS "productName", u.code AS unit, s.net_quantity::float AS "netQuantity",
                s.quantity::float AS quantity, s.release_date AS "releaseDate", s.due_date AS "dueDate",
                CASE WHEN s.is_late THEN 'Sí' ELSE 'No' END AS late, COALESCE(sp.trade_name, sp.legal_name) AS supplier,
                CASE s.status WHEN 'open' THEN 'Abierta' WHEN 'converted' THEN 'Convertida' ELSE 'Descartada' END AS status,
                s.document_number AS document
           FROM last JOIN mrp_suggestions s ON s.run_id = last.id
           JOIN products p ON p.id = s.product_id
           JOIN catalogs_units u ON u.id = p.stock_unit_id
           LEFT JOIN suppliers sp ON sp.id = s.supplier_id
          ORDER BY s.kind DESC, s.release_date, p.code`
      )
  },
  {
    code: "ALERTS",
    name: "Alertas abiertas",
    description: "Alarmas vigentes que usted puede ver, por severidad, con su detalle y desde cuándo están abiertas.",
    module: "DSH_ALERTS",
    ranged: false,
    columns: [
      { key: "severity", header: "Severidad", type: "text", width: 12 },
      { key: "kind", header: "Tipo", type: "text", width: 22 },
      { key: "module", header: "Módulo", type: "text", width: 22 },
      { key: "title", header: "Alerta", type: "text", width: 40 },
      { key: "message", header: "Detalle", type: "text", width: 70 },
      { key: "warehouse", header: "Almacén", type: "text", width: 12 },
      { key: "firstSeenAt", header: "Desde", type: "datetime" }
    ],
    rows: async ({ userId }) =>
      query<{ severity: string; kind: (typeof ALERT_KINDS)[number] }>(
        `SELECT a.severity, a.kind, m.name AS module, a.title, a.message, w.code AS warehouse, to_char(a.first_seen_at, 'YYYY-MM-DD HH24:MI') AS "firstSeenAt"
           FROM alerts a JOIN catalogs_modules m ON m.code = a.module_code LEFT JOIN warehouses w ON w.id = a.warehouse_id
          WHERE a.resolved_at IS NULL AND ${alertVisibleTo("$1")}
          ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.kind, a.first_seen_at`,
        [userId]
      ).then((rows) => rows.map((r) => ({ ...r, severity: SEVERITY_LABEL[r.severity], kind: KIND_LABEL[r.kind] })))
  }
];

// ------------------------------------------------------------------ Resumen de los reportes anteriores

const ddmm = (iso: unknown) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const withOne = (rows: Row[]) => rows.map((r) => ({ ...r, _one: 1 }));
const count = (rows: Row[], pred: (r: Row) => boolean) => rows.filter(pred).length;
const valid = (r: Row) => r.status !== "Reversado";

const EXTRAS: Record<string, Pick<ReportDef, "group"> & Partial<ReportDef>> = {
  STOCK_VALUED: {
    group: "Inventario",
    kpis: [
      { key: "value", label: "Valor del inventario", type: "money", value: (r) => sum(r, "value"), usd: (r) => sumUsd(r, "value"), help: "Al costo promedio; en USD con la tasa de hoy" },
      { key: "products", label: "Productos con existencia", type: "int", value: (r) => distinct(r, "productCode") },
      { key: "warehouses", label: "Almacenes", type: "int", value: (r) => distinct(r, "warehouse") },
      { key: "quarantine", label: "Líneas en cuarentena", type: "int", value: (r) => count(r, (x) => x.qualityStatus === "quarantine") }
    ],
    charts: [
      { title: "Valor por almacén", kind: "bar", type: "money", horizontal: true, series: [{ key: "value", label: "Valor" }], data: (r) => groupSum(r, "warehouse", ["value"], { sortBy: "value" }) },
      { title: "Valor por tipo de producto", kind: "donut", type: "money", series: [{ key: "value", label: "Valor" }], data: (r) => groupSum(r, "productType", ["value"], { sortBy: "value" }) }
    ]
  },
  LOTS_EXPIRY: {
    group: "Inventario",
    kpis: [
      { key: "expired", label: "Lotes vencidos", type: "int", value: (r) => count(r, (x) => x.daysLeft !== null && Number(x.daysLeft) < 0) },
      { key: "soon", label: "Vencen en 30 días", type: "int", value: (r) => count(r, (x) => x.daysLeft !== null && Number(x.daysLeft) >= 0 && Number(x.daysLeft) <= 30) },
      {
        key: "atRisk",
        label: "Valor en riesgo",
        type: "money",
        value: (r) => sum(r.filter((x) => x.daysLeft !== null && Number(x.daysLeft) <= 30), "value"),
        usd: (r) => sumUsd(r.filter((x) => x.daysLeft !== null && Number(x.daysLeft) <= 30), "value"),
        help: "Lotes vencidos o que vencen en los próximos 30 días"
      }
    ],
    charts: [
      {
        title: "Valor por plazo de vencimiento",
        kind: "bar",
        type: "money",
        series: [{ key: "value", label: "Valor" }],
        data: (r) => {
          const bucket = (x: Row) => {
            if (x.daysLeft === null) return "Sin vencimiento";
            const d = Number(x.daysLeft);
            return d < 0 ? "Vencido" : d <= 30 ? "0 a 30 días" : d <= 90 ? "31 a 90 días" : "Más de 90 días";
          };
          return groupSum(r, bucket, ["value"], { order: ["Vencido", "0 a 30 días", "31 a 90 días", "Más de 90 días", "Sin vencimiento"] });
        }
      }
    ]
  },
  MOVEMENTS: {
    group: "Inventario",
    kpis: [
      { key: "movements", label: "Movimientos", type: "int", value: (r) => distinct(r, "number") },
      {
        key: "in",
        label: "Entradas",
        type: "money",
        value: (r) => sum(r.filter((x) => x.direction === "Entrada" && valid(x)), "totalCost"),
        usd: (r) => sumUsd(r.filter((x) => x.direction === "Entrada" && valid(x)), "totalCost")
      },
      {
        key: "out",
        label: "Salidas",
        type: "money",
        value: (r) => sum(r.filter((x) => x.direction === "Salida" && valid(x)), "totalCost"),
        usd: (r) => sumUsd(r.filter((x) => x.direction === "Salida" && valid(x)), "totalCost")
      },
      { key: "reversed", label: "Reversados", type: "int", value: (r) => distinct(r.filter((x) => !valid(x)), "number"), better: "down" }
    ],
    charts: [
      {
        title: "Costo por concepto",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "totalCost", label: "Costo" }],
        data: (r) => groupSum(r.filter(valid), "concept", ["totalCost"], { sortBy: "totalCost", top: 10 })
      }
    ]
  },
  PURCHASES: {
    group: "Compras",
    kpis: [
      { key: "amount", label: "Comprado", type: "money", value: (r) => sum(r, "netBase"), usd: (r) => sumUsd(r, "netBase") },
      { key: "orders", label: "Órdenes de compra", type: "int", value: (r) => distinct(r, "number") },
      { key: "suppliers", label: "Proveedores", type: "int", value: (r) => distinct(r, "supplier") },
      {
        key: "pending",
        label: "Pendiente por recibir",
        type: "money",
        value: (r) => r.reduce((t, x) => t + (Number(x.quantity) ? (Number(x.pending) / Number(x.quantity)) * Number(x.netBase) : 0), 0),
        help: "Parte no recibida de las líneas, valorada a su precio"
      }
    ],
    charts: [
      {
        title: "Los 10 proveedores con más compras",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "netBase", label: "Neto (moneda base)" }],
        data: (r) => groupSum(r, "supplier", ["netBase"], { sortBy: "netBase", top: 10 })
      }
    ]
  },
  SALES: {
    group: "Ventas",
    kpis: [
      { key: "sales", label: "Venta neta", type: "money", value: (r) => sum(r, "sales"), usd: (r) => sumUsd(r, "sales"), better: "up" },
      { key: "margin", label: "Margen", type: "money", value: (r) => sum(r, "margin"), usd: (r) => sumUsd(r, "margin"), better: "up" },
      { key: "marginPct", label: "Margen %", type: "pct", value: (r) => ratio(sum(r, "margin"), sum(r, "sales")), better: "up" },
      { key: "notes", label: "Notas de entrega", type: "int", value: (r) => distinct(r, "note") }
    ],
    charts: [
      {
        title: "Venta neta por día",
        kind: "line",
        type: "money",
        series: [{ key: "sales", label: "Venta neta" }],
        data: (r) =>
          groupSum(r, (x) => String(x.deliveryDate).slice(0, 10), ["sales"])
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((p) => ({ ...p, label: ddmm(p.label) }))
      }
    ]
  },
  PRODUCTION: {
    group: "Producción",
    kpis: [
      { key: "orders", label: "Órdenes", type: "int", value: (r) => r.length },
      { key: "onTime", label: "Terminadas a tiempo", type: "pct", value: (r) => ratio(count(r, (x) => x.onTime === "Sí"), count(r, (x) => x.onTime !== null)), better: "up" },
      { key: "variance", label: "Variación de costo", type: "money", value: (r) => sum(r, "variance"), better: "down", help: "Costo real menos estándar de lo fabricado; positivo = costó más" },
      { key: "variancePct", label: "Variación %", type: "pct", value: (r) => ratio(sum(r, "variance"), sum(r, "stdCost")), better: "down" }
    ],
    charts: [
      {
        title: "Variación de costo por producto",
        kind: "bar",
        type: "money",
        horizontal: true,
        series: [{ key: "variance", label: "Variación" }],
        data: (r) => groupSum(r, "productName", ["variance"], { sortBy: "variance", top: 10 })
      }
    ]
  },
  MRP: {
    group: "Producción",
    kpis: [
      { key: "make", label: "A fabricar", type: "int", value: (r) => count(r, (x) => x.kind === "Fabricar") },
      { key: "buy", label: "A comprar", type: "int", value: (r) => count(r, (x) => x.kind === "Comprar") },
      { key: "late", label: "Atrasadas", type: "int", value: (r) => count(r, (x) => x.late === "Sí") },
      { key: "open", label: "Abiertas", type: "int", value: (r) => count(r, (x) => x.status === "Abierta") }
    ]
  },
  ALERTS: {
    group: "Tablero",
    kpis: [
      { key: "critical", label: "Críticas", type: "int", value: (r) => count(r, (x) => x.severity === "Crítica") },
      { key: "warning", label: "Advertencias", type: "int", value: (r) => count(r, (x) => x.severity === "Advertencia") },
      { key: "info", label: "Avisos", type: "int", value: (r) => count(r, (x) => x.severity === "Aviso") }
    ],
    charts: [
      {
        title: "Alertas por tipo",
        kind: "bar",
        type: "int",
        horizontal: true,
        series: [{ key: "_one", label: "Alertas" }],
        data: (r) => groupSum(withOne(r), "kind", ["_one"], { sortBy: "_one" })
      }
    ]
  }
};

/** Orden del menú: por área (REPORT_GROUPS); dentro de cada una, en el orden en que se definen */
const REPORTS: ReportDef[] = [
  ...MANAGEMENT_REPORTS,
  ...SALES_REPORTS,
  ...SALES_ANALYSIS_REPORTS,
  ...CUSTOMER_REPORTS,
  ...POS_REPORTS,
  ...INVENTORY_REPORTS,
  ...STOCK_FLOW_REPORTS,
  ...PURCHASE_REPORTS,
  ...PRODUCTION_REPORTS,
  ...FISCAL_REPORTS,
  ...BASE_REPORTS.map((r) => ({ ...r, ...EXTRAS[r.code] }) as ReportDef)
].sort((a, b) => REPORT_GROUPS.indexOf(a.group) - REPORT_GROUPS.indexOf(b.group));

// ------------------------------------------------------------------ Acceso y parámetros

const modulesOf = (def: ReportDef) => (Array.isArray(def.module) ? def.module : [def.module]);
/** País y moneda base de la empresa activa: hay reportes que solo aplican a algunas */
interface CompanyInfo {
  country: string;
  base: string;
}
const companyInfo = async (): Promise<CompanyInfo> =>
  (await one<CompanyInfo>(
    `SELECT co.country_code AS country, TRIM(c.code) AS base FROM companies co JOIN catalogs_currencies c ON c.id = co.base_currency_id WHERE co.id = fn_current_company()`
  ))!;
const applies = (def: ReportDef, co: CompanyInfo) => (!def.countries || def.countries.includes(co.country)) && !(def.foreignBaseOnly && co.base === "USD");
const canSee = (access: ModuleAccess, def: ReportDef) => modulesOf(def).some((m) => canView(access, m));
const available = (access: ModuleAccess, co: CompanyInfo) => REPORTS.filter((r) => applies(r, co) && canSee(access, r));

const rangeQuery = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "La fecha inicial debe ser anterior a la final", path: ["from"] });

export interface KpiOut {
  key: string;
  label: string;
  type: ColType;
  value: number | string | null;
  /** Equivalente en dólares (null si la base ya es el dólar o no hay tasa) */
  usd: number | null;
  /** Mismo indicador en el período anterior (solo reportes que comparan) */
  previous: number | string | null;
  /** Variación relativa contra el período anterior */
  change: number | null;
  better: "up" | "down" | null;
  help: string | null;
  /** Moneda del monto si no es la base */
  currency: string | null;
}

export interface ChartOut {
  title: string;
  kind: ChartDef["kind"];
  type: ColType;
  horizontal: boolean;
  currency: string | null;
  series: { key: string; label: string }[];
  data: ChartPoint[];
}

interface Summary {
  kpis: KpiOut[];
  charts: ChartOut[];
  /** Período con el que se comparó */
  previous: { from: string; to: string } | null;
}

/** Indicadores (comparados con el período anterior si corresponde) y gráficos de un reporte */
async function summarize(def: ReportDef, ctx: Ctx, rows: Row[]): Promise<Summary> {
  const compare = def.ranged && def.compare !== false && Boolean(def.kpis?.length);
  const prev = compare ? previousRange(ctx.from, ctx.to) : null;
  const prevCtx = prev ? { ...ctx, ...prev } : null;
  const prevRows = prevCtx ? await def.rows(prevCtx) : null;
  const usdOk = ctx.base !== "USD";
  const kpis = (def.kpis ?? []).map((k): KpiOut => {
    const value = k.value(rows, ctx);
    const previous = prevRows && prevCtx ? k.value(prevRows, prevCtx) : null;
    return {
      key: k.key,
      label: k.label,
      type: k.type,
      value,
      usd: usdOk && k.usd ? k.usd(rows, ctx) : null,
      previous,
      change: typeof value === "number" && typeof previous === "number" && previous !== 0 ? (value - previous) / Math.abs(previous) : null,
      better: k.better ?? null,
      help: k.help ?? null,
      currency: k.currency ?? null
    };
  });
  const charts = (def.charts ?? [])
    .map((c) => ({
      title: c.title,
      kind: c.kind,
      type: c.type,
      horizontal: Boolean(c.horizontal),
      currency: c.currency ?? null,
      series: c.series,
      data: c.data(rows, ctx)
    }))
    .filter((c) => c.data.length > 0);
  return { kpis, charts, previous: prev };
}

async function prepare(req: Parameters<typeof authOf>[0], code: string, q: z.infer<typeof rangeQuery>) {
  const def = REPORTS.find((r) => r.code === code);
  if (!def) throw notFound("Reporte no encontrado");
  const userId = authOf(req).userId;
  const access = await moduleAccess(userId);
  if (!applies(def, await companyInfo())) throw notFound("Este reporte no aplica a la empresa activa");
  if (!canSee(access, def)) throw forbidden("NO_SOURCE_PERMISSION", "No tiene acceso al módulo de origen de este reporte");
  // Rango por defecto: los últimos días del reporte (31 si no indica), calculados en la BD
  const d = (await one<{ from: string; to: string; base: string }>(
    `SELECT (CURRENT_DATE - $1::int)::text AS from, CURRENT_DATE::text AS to,
            (SELECT TRIM(c.code) FROM companies co JOIN catalogs_currencies c ON c.id = co.base_currency_id WHERE co.id = fn_current_company()) AS base`,
    [(def.defaultDays ?? 31) - 1]
  ))!;
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (def.ranged && days > 731) throw badRequest("RANGE_TOO_LONG", "El rango no puede pasar de dos años");
  const ctx: Ctx = { userId, access, from, to, base: d.base };
  const rows = await def.rows(ctx);
  // Con base en dólares, las columnas «USD» repetirían las de moneda base
  const columns = def.columns.filter((c) => !(c.usd && d.base === "USD"));
  return { def, ctx, rows, columns, from, to };
}

export const listReports = handler({}, async ({ req }) => {
  const [access, co] = await Promise.all([moduleAccess(authOf(req).userId), companyInfo()]);
  const names = new Map(
    (await query<{ code: string; name: string }>(`SELECT code, name FROM catalogs_modules`)).map((m) => [m.code, m.name])
  );
  return available(access, co).map((r) => {
    const module = modulesOf(r).find((m) => canView(access, m))!;
    return {
      code: r.code,
      name: r.name,
      description: r.description,
      group: r.group,
      module,
      moduleName: modulesOf(r)
        .filter((m) => canView(access, m))
        .map((m) => names.get(m))
        .join(" · "),
      ranged: r.ranged,
      defaultDays: r.ranged ? (r.defaultDays ?? 31) : null
    };
  });
});

const codeParams = z.object({ code: z.string().regex(/^[A-Z_]+$/) });

/** Sin las claves internas («_…»): no salen del servidor */
const publicRow = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));

/** Vista previa: resumen, columnas y primeras 100 filas */
export const previewReport = handler({ params: codeParams, query: rangeQuery }, async ({ params, query: q, req }) => {
  const { def, ctx, rows, columns, from, to } = await prepare(req, params.code, q);
  const summary = await summarize(def, ctx, rows);
  return {
    code: def.code,
    name: def.name,
    ranged: def.ranged,
    from,
    to,
    base: ctx.base,
    summary,
    columns,
    rows: rows.slice(0, 100).map(publicRow),
    total: rows.length
  };
});

// ------------------------------------------------------------------ Excel

const NUM_FMT: Partial<Record<ColType, string>> = {
  int: "#,##0",
  qty: "#,##0.###",
  money: "#,##0.00",
  pct: "0.0%",
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm"
};
const DEFAULT_WIDTH: Record<ColType, number> = { text: 18, int: 10, qty: 13, money: 15, pct: 11, date: 12, datetime: 17 };

function cellValue(col: Column, v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (col.type === "date") return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  // Llega como 'YYYY-MM-DD HH24:MI' en la hora local de la BD; Excel no maneja zonas horarias.
  if (col.type === "datetime") return new Date(`${String(v).replace(" ", "T")}:00Z`);
  // exceljs escribe el texto como celda de texto (nunca como fórmula), aunque empiece con «=».
  if (col.type === "text") return col.key === "qualityStatus" ? (QC_LABEL[String(v)] ?? String(v)) : String(v);
  return Number(v);
}

const LOGO_HEIGHT = 48;

/**
 * Cabecera con la identidad de la empresa: logo (si tiene) en la fila 1, luego razón social y RIF,
 * nombre del reporte y fecha de emisión. Devuelve la fila donde va el encabezado de columnas.
 */
function brandHeader(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, last: number, brand: Branding | null, lines: { title: string; info: string }) {
  const color = `FF${(brand?.brandColor ?? "#167c94").slice(1).toUpperCase()}`;
  let row = 1;
  if (brand?.logo) {
    const image = wb.addImage({ buffer: brand.logo.png as unknown as ExcelJS.Buffer, extension: "png" });
    const width = Math.round((brand.logo.width / brand.logo.height) * LOGO_HEIGHT);
    ws.addImage(image, { tl: { col: 0, row: 0 }, ext: { width, height: LOGO_HEIGHT }, editAs: "oneCell" });
    ws.getRow(1).height = LOGO_HEIGHT * 0.78; // puntos ≈ px × 0,75 (+ margen)
    row = 2;
  }
  const put = (r: number, value: string, font: Partial<ExcelJS.Font>) => {
    ws.mergeCells(r, 1, r, last);
    ws.getCell(r, 1).value = value;
    ws.getCell(r, 1).font = font;
  };
  put(row, brand ? `${brand.legalName} · ${brand.taxIdLabel} ${brand.rif}` : "FabriHub", { bold: true, size: 14, color: { argb: color } });
  put(row + 1, lines.title, { bold: true, size: 12 });
  put(row + 2, lines.info, { size: 9, color: { argb: "FF6B7280" } });
  return { headerRow: row + 4, color };
}

const fmtIsoDate = (iso: string) => iso.split("-").reverse().join("/");

/** Fila de encabezado de una tabla del resumen, con el color de la empresa */
function headRow(ws: ExcelJS.Worksheet, rowNo: number, labels: string[], color: string) {
  const row = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const cell = row.getCell(i + 1);
    cell.value = l;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center", wrapText: true };
  });
  row.height = 22;
}

/**
 * Hoja «Resumen»: indicadores (con su equivalente en dólares y la comparación con el período
 * anterior) y, debajo, los datos de cada gráfico de la vista previa como tabla.
 */
function summarySheet(wb: ExcelJS.Workbook, summary: Summary, meta: { brand: Branding | null; info: string; title: string; base: string }) {
  const ws = wb.addWorksheet("Resumen");
  const compare = Boolean(summary.previous);
  const usd = meta.base !== "USD" && summary.kpis.some((k) => k.usd !== null);
  const heads = ["Indicador", `Valor (${meta.base})`, ...(usd ? ["Equivalente USD"] : []), ...(compare ? ["Período anterior", "Variación"] : [])];
  const width = Math.max(heads.length, 2);
  const { headerRow, color } = brandHeader(wb, ws, width, meta.brand, { title: `${meta.title} · Resumen`, info: meta.info });
  ws.getColumn(1).width = 34;
  for (let i = 2; i <= 6; i++) ws.getColumn(i).width = 18;

  let r = headerRow;
  if (summary.kpis.length) {
    if (summary.previous) {
      ws.getCell(r - 1, 1).value = `Comparado con el ${fmtIsoDate(summary.previous.from)} al ${fmtIsoDate(summary.previous.to)}`;
      ws.getCell(r - 1, 1).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
    }
    headRow(ws, r, heads, color);
    for (const k of summary.kpis) {
      r++;
      const row = ws.getRow(r);
      const fmt = k.type === "text" ? undefined : NUM_FMT[k.type];
      let c = 1;
      row.getCell(c++).value = k.label;
      const put = (v: unknown, f?: string) => {
        const cell = row.getCell(c++);
        cell.value = v === null || v === undefined ? null : typeof v === "number" ? v : String(v);
        if (f && typeof v === "number") cell.numFmt = f;
      };
      put(k.value, fmt);
      if (usd) put(k.usd, NUM_FMT.money);
      if (compare) {
        put(k.previous, fmt);
        put(k.change, NUM_FMT.pct);
      }
    }
    r += 3;
  }

  for (const chart of summary.charts) {
    ws.getCell(r, 1).value = chart.title;
    ws.getCell(r, 1).font = { bold: true, size: 11 };
    r++;
    headRow(ws, r, ["", ...chart.series.map((s) => s.label)], color);
    for (const p of chart.data) {
      r++;
      const row = ws.getRow(r);
      row.getCell(1).value = p.label;
      chart.series.forEach((s, i) => {
        const cell = row.getCell(i + 2);
        cell.value = p[s.key] === null || p[s.key] === undefined ? null : Number(p[s.key]);
        cell.numFmt = NUM_FMT[chart.type] ?? NUM_FMT.money!;
      });
    }
    r += 3;
  }
}

async function buildWorkbook(
  def: ReportDef,
  columns: Column[],
  rows: Row[],
  summary: Summary,
  meta: { brand: Branding | null; user: string; from: string; to: string; base: string }
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FabriHub";
  wb.created = new Date();
  const range = def.ranged ? `Del ${fmtIsoDate(meta.from)} al ${fmtIsoDate(meta.to)} · ` : "";
  const now = new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short", timeZone: meta.brand?.timezone ?? "America/Caracas" }).format(new Date());
  const info = `${range}Emitido el ${now} por ${meta.user} · ${rows.length} fila(s)`;
  if (summary.kpis.length || summary.charts.length) summarySheet(wb, summary, { brand: meta.brand, info, title: def.name, base: meta.base });

  const last = columns.length;
  const headerRowNo = meta.brand?.logo ? 6 : 5;
  const ws = wb.addWorksheet(summary.kpis.length || summary.charts.length ? "Detalle" : def.name.slice(0, 31), { views: [{ state: "frozen", ySplit: headerRowNo }] });
  const { color: BRAND } = brandHeader(wb, ws, last, meta.brand, { title: def.name, info });

  const header = ws.getRow(headerRowNo);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", horizontal: c.type === "text" ? "left" : "center", wrapText: true };
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? DEFAULT_WIDTH[c.type];
    if (NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type]!;
  });
  header.height = 30;

  for (const r of rows) ws.addRow(columns.map((c) => cellValue(c, r[c.key])));

  const firstData = headerRowNo + 1;
  const lastData = firstData + rows.length - 1;
  if (rows.length > 0 && columns.some((c) => c.total)) {
    const totals = ws.getRow(lastData + 2);
    totals.getCell(1).value = "Totales";
    columns.forEach((c, i) => {
      if (!c.total) return;
      const letter = ws.getColumn(i + 1).letter;
      const total = sum(rows, c.key);
      totals.getCell(i + 1).value = { formula: `SUBTOTAL(9,${letter}${firstData}:${letter}${lastData})`, result: total };
    });
    totals.font = { bold: true };
    totals.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF9CA3AF" } } }));
  }
  if (rows.length > 0) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: lastData, column: last } };
  return wb.xlsx.writeBuffer();
}

export const downloadReport = handler({ params: codeParams, query: rangeQuery }, async ({ params, query: q, req, res }) => {
  const { def, ctx, rows, columns, from, to } = await prepare(req, params.code, q);
  const summary = await summarize(def, ctx, rows);
  const brand = await companyBranding(authOf(req).companyId);
  const buffer = await buildWorkbook(def, columns, rows, summary, { brand, user: authOf(req).names, from, to, base: ctx.base });
  const stamp = def.ranged ? `${from}_${to}` : to;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="FabriHub_${def.code}_${stamp}.xlsx"`);
  res.end(Buffer.from(buffer));
  return undefined;
});
