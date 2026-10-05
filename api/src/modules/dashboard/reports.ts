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
 */

import ExcelJS from "exceljs";
import { z } from "zod";
import { one, query } from "../../db.js";
import { badRequest, forbidden, handler, notFound } from "../../lib/http.js";
import { authOf } from "../../security/context.js";
import { ALERT_KINDS } from "./alerts.js";
import { type ModuleAccess, alertVisibleTo, canView, moduleAccess, ownerScopeOf, warehouseScopeOf } from "./access.js";

type ColType = "text" | "int" | "qty" | "money" | "pct" | "date" | "datetime";

interface Column {
  key: string;
  header: string;
  type: ColType;
  width?: number;
  /** Suma la columna en la fila de totales */
  total?: boolean;
}

interface Ctx {
  userId: string;
  access: ModuleAccess;
  from: string;
  to: string;
}

interface ReportDef {
  code: string;
  name: string;
  description: string;
  module: string;
  /** El reporte filtra por rango de fechas */
  ranged: boolean;
  columns: Column[];
  rows: (ctx: Ctx) => Promise<Record<string, unknown>[]>;
}

const KIND_LABEL: Record<(typeof ALERT_KINDS)[number], string> = {
  STOCK_MIN: "Stock bajo el mínimo",
  STOCK_MAX: "Stock sobre el máximo",
  LOT_EXPIRING: "Lote por vencer",
  LOT_EXPIRED: "Lote vencido",
  QC_PENDING: "Cuarentena prolongada",
  PO_OVERDUE: "OC atrasada",
  PRO_LATE: "OP atrasada",
  SO_LATE: "OV atrasada"
};
const SEVERITY_LABEL: Record<string, string> = { critical: "Crítica", warning: "Advertencia", info: "Aviso" };
const QC_LABEL: Record<string, string> = { quarantine: "Cuarentena", approved: "Aprobado", rejected: "Rechazado", on_hold: "Retenido" };

const REPORTS: ReportDef[] = [
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
                (b.quantity * CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE 0 END)::float AS value
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
                s.quantity::float AS quantity, s.value::float AS value
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
                CASE m.status WHEN 'reversed' THEN 'Reversado' ELSE 'Contabilizado' END AS status, m.reference
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
      { key: "netAmount", header: "Neto (moneda OC)", type: "money" },
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
                d.net_amount::float AS "netAmount", (d.net_amount * po.exchange_rate)::float AS "netBase"
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
    name: "Ventas y margen",
    description: "Líneas despachadas en el rango: venta neta en moneda base, costo promedio y margen por lote.",
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
                        (d.quantity * d.unit_price * so.exchange_rate)::float AS sales,
                        (d.stock_quantity * COALESCE(d.unit_cost, 0))::float AS cost, d.line_no
                   FROM delivery_notes_details d
                   JOIN delivery_notes n ON n.id = d.delivery_note_id
                   JOIN sales_orders so ON so.id = n.sales_order_id
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

// ------------------------------------------------------------------ Acceso y parámetros

const available = (access: ModuleAccess) => REPORTS.filter((r) => canView(access, r.module));

const rangeQuery = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "La fecha inicial debe ser anterior a la final", path: ["from"] });

async function prepare(req: Parameters<typeof authOf>[0], code: string, q: z.infer<typeof rangeQuery>) {
  const def = REPORTS.find((r) => r.code === code);
  if (!def) throw notFound("Reporte no encontrado");
  const userId = authOf(req).userId;
  const access = await moduleAccess(userId);
  if (!canView(access, def.module)) throw forbidden("NO_SOURCE_PERMISSION", "No tiene acceso al módulo de origen de este reporte");
  // Rango por defecto: últimos 30 días, calculados en la BD (zona America/Caracas)
  const d = (await one<{ from: string; to: string }>(`SELECT (CURRENT_DATE - 30)::text AS from, CURRENT_DATE::text AS to`))!;
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (def.ranged && days > 731) throw badRequest("RANGE_TOO_LONG", "El rango no puede pasar de dos años");
  const rows = await def.rows({ userId, access, from, to });
  return { def, rows, from, to };
}

export const listReports = handler({}, async ({ req }) => {
  const access = await moduleAccess(authOf(req).userId);
  const names = new Map(
    (await query<{ code: string; name: string }>(`SELECT code, name FROM catalogs_modules`)).map((m) => [m.code, m.name])
  );
  return available(access).map(({ code, name, description, module, ranged }) => ({ code, name, description, module, moduleName: names.get(module), ranged }));
});

const codeParams = z.object({ code: z.string().regex(/^[A-Z_]+$/) });

/** Vista previa: columnas y primeras 100 filas */
export const previewReport = handler({ params: codeParams, query: rangeQuery }, async ({ params, query: q, req }) => {
  const { def, rows, from, to } = await prepare(req, params.code, q);
  return { code: def.code, name: def.name, ranged: def.ranged, from, to, columns: def.columns, rows: rows.slice(0, 100), total: rows.length };
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
const BRAND = "FF167C94";

function cellValue(col: Column, v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (col.type === "date") return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  // Llega como 'YYYY-MM-DD HH24:MI' en la hora local de la BD; Excel no maneja zonas horarias.
  if (col.type === "datetime") return new Date(`${String(v).replace(" ", "T")}:00Z`);
  // exceljs escribe el texto como celda de texto (nunca como fórmula), aunque empiece con «=».
  if (col.type === "text") return col.key === "qualityStatus" ? (QC_LABEL[String(v)] ?? String(v)) : String(v);
  return Number(v);
}

async function buildWorkbook(def: ReportDef, rows: Record<string, unknown>[], meta: { company: string; user: string; from: string; to: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FabriHub";
  wb.created = new Date();
  const ws = wb.addWorksheet(def.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 5 }] });
  const last = def.columns.length;

  ws.mergeCells(1, 1, 1, last);
  ws.getCell(1, 1).value = meta.company;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BRAND } };
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).value = def.name;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.mergeCells(3, 1, 3, last);
  const range = def.ranged ? `Del ${meta.from.split("-").reverse().join("/")} al ${meta.to.split("-").reverse().join("/")} · ` : "";
  const now = new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Caracas" }).format(new Date());
  ws.getCell(3, 1).value = `${range}Generado el ${now} por ${meta.user} · ${rows.length} fila(s)`;
  ws.getCell(3, 1).font = { size: 9, color: { argb: "FF6B7280" } };

  const header = ws.getRow(5);
  def.columns.forEach((c, i) => {
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

  for (const r of rows) ws.addRow(def.columns.map((c) => cellValue(c, r[c.key])));

  const firstData = 6;
  const lastData = firstData + rows.length - 1;
  if (rows.length > 0 && def.columns.some((c) => c.total)) {
    const totals = ws.getRow(lastData + 2);
    totals.getCell(1).value = "Totales";
    def.columns.forEach((c, i) => {
      if (!c.total) return;
      const letter = ws.getColumn(i + 1).letter;
      const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      totals.getCell(i + 1).value = { formula: `SUBTOTAL(9,${letter}${firstData}:${letter}${lastData})`, result: sum };
    });
    totals.font = { bold: true };
    totals.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF9CA3AF" } } }));
  }
  if (rows.length > 0) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastData, column: last } };
  return wb.xlsx.writeBuffer();
}

export const downloadReport = handler({ params: codeParams, query: rangeQuery }, async ({ params, query: q, req, res }) => {
  const { def, rows, from, to } = await prepare(req, params.code, q);
  const company = await one<{ name: string }>(`SELECT COALESCE(trade_name, legal_name) AS name FROM company LIMIT 1`);
  const buffer = await buildWorkbook(def, rows, { company: company?.name ?? "FabriHub", user: authOf(req).names, from, to });
  const stamp = def.ranged ? `${from}_${to}` : to;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="FabriHub_${def.code}_${stamp}.xlsx"`);
  res.end(Buffer.from(buffer));
  return undefined;
});
