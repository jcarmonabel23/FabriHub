/**
 * @project FabriHub - API
 * @file src/modules/sales/orders.ts
 * @description Órdenes de venta (SAL_ORDERS) — tesis: Clases Orden de Venta y Detalles Orden de Venta
 *
 * @overview
 *   draft ──confirmar──▶ confirmed ──notas de entrega──▶ partially_delivered ──▶ delivered
 *     │  └─(excede crédito)─▶ pending_approval ──aprobar──▶ confirmed       │ cerrar
 *     │                          │ devolver                                   ▼
 *     └──────────────────────────┘                                          closed
 *
 *  - El cálculo (precio sugerido, IVA y retenciones) es el mismo motor de Compras. La retención
 *    aplica solo si el CLIENTE es agente de retención (contribuyente especial): él nos retiene.
 *  - Confirmar controla el crédito: si (órdenes abiertas + esta) en moneda base supera el límite
 *    del cliente, la orden queda retenida y debe aprobarla OTRA persona con permiso approve.
 *  - Confirmar (o aprobar) RESERVA existencia por FEFO en el almacén de despacho. Lo que no alcanza
 *    queda pendiente (BackOrder) si SALES.allow_backorder; si no, la confirmación se rechaza.
 *    "Reservar" vuelve a intentar lo pendiente cuando entra existencia (p. ej. una OP liberada por Calidad).
 *  - Sin el permiso view_all, cada usuario ve solo las órdenes que creó.
 */

import { z } from "zod";
import type pg from "pg";
import type { Request } from "express";
import { one, pool, query, withTx, type Db } from "../../db.js";
import { HttpError, badRequest, conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";
import { computeDocument, resolveTreatment, type DocumentResult, type ResolvedTreatment } from "../taxes/document.js";
import { suggestPrice } from "../pricing/priceLists.js";
import { exchangeRate, loadTreatments } from "../purchases/fiscal.js";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-9;

// ------------------------------------------------------------------ Entrada

const lineSchema = z.object({
  productId: z.uuid(),
  unitId: z.uuid().nullish(),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12).nullish(),
  discountPct: z.number().min(0).max(100).default(0),
  notes: z.string().trim().max(400).nullish()
});

export const orderBody = z.object({
  customerId: z.uuid(),
  orderDate: z.iso.date(),
  requestedDate: z.iso.date().nullish(),
  warehouseId: z.uuid(),
  currencyId: z.uuid().nullish(),
  contactId: z.uuid().nullish(),
  sellerId: z.uuid().nullish(),
  paymentTermId: z.uuid().nullish(),
  deliveryTermId: z.uuid().nullish(),
  deliveryMethodId: z.uuid().nullish(),
  deliveryAddress: z.string().trim().max(400).nullish(),
  discountPct: z.number().min(0).max(100).default(0),
  customerReference: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(800).nullish(),
  lines: z.array(lineSchema).min(1, "Agregue al menos una línea").max(200)
});
type OrderInput = z.infer<typeof orderBody>;

// ------------------------------------------------------------------ Cálculo

interface BuiltLine {
  productId: string;
  unitId: string;
  unitFactor: number;
  quantity: number;
  unitPrice: number;
  priceSource: string | null;
  discountPct: number;
  treatmentId: string | null;
  taxRate: number;
  net: number;
  tax: number;
  notes: string | null;
}

interface BuiltOrder {
  header: OrderInput & {
    currencyId: string;
    exchangeRate: number;
    sellerId: string | null;
    paymentTermId: string | null;
    deliveryTermId: string | null;
    deliveryMethodId: string | null;
    deliveryAddress: string | null;
  };
  lines: BuiltLine[];
  totals: DocumentResult;
}

interface ProductRow {
  id: string;
  code: string;
  is_active: boolean;
  is_sold: boolean;
  is_on_hold: boolean;
  stock_unit_id: string;
  sale_unit_id: string | null;
  sale_factor: string;
  fiscal_treatment_id: string | null;
  sale_price: string | null;
}

export async function buildOrder(db: Db | pg.PoolClient, input: OrderInput): Promise<BuiltOrder> {
  const customer = await one<{
    is_active: boolean;
    currency_id: string | null;
    seller_id: string | null;
    payment_term_id: string | null;
    delivery_term_id: string | null;
    delivery_method_id: string | null;
    delivery_address: string | null;
    price_list_id: string | null;
    fiscal_treatment_id: string | null;
    is_withholding_agent: boolean;
  }>(
    `SELECT is_active, currency_id, seller_id, payment_term_id, delivery_term_id, delivery_method_id, COALESCE(delivery_address, address) AS delivery_address,
            price_list_id, fiscal_treatment_id, is_withholding_agent
       FROM customers WHERE id = $1`,
    [input.customerId],
    db
  );
  if (!customer) throw badRequest("INVALID_CUSTOMER", "Cliente inexistente");
  if (!customer.is_active) throw badRequest("INACTIVE_CUSTOMER", "El cliente está inactivo");

  const base = await one<{ id: string }>(`SELECT base_currency_id AS id FROM company WHERE id = 1`, [], db);
  const currencyId = input.currencyId ?? customer.currency_id ?? base!.id;
  const rate = await exchangeRate(db, currencyId, input.orderDate);

  const products = new Map(
    (
      await query<ProductRow>(
        `SELECT id, code, is_active, is_sold, is_on_hold, stock_unit_id, sale_unit_id, sale_factor, fiscal_treatment_id, sale_price
           FROM products WHERE id = ANY($1)`,
        [[...new Set(input.lines.map((l) => l.productId))]],
        db
      )
    ).map((p) => [p.id, p])
  );

  const treatments = await loadTreatments(
    db,
    [customer.fiscal_treatment_id ?? "", ...[...products.values()].map((p) => p.fiscal_treatment_id ?? "")],
    input.orderDate
  );
  const party = customer.fiscal_treatment_id ? treatments.get(customer.fiscal_treatment_id) ?? null : null;

  const lines: Omit<BuiltLine, "net" | "tax">[] = [];
  const resolved: ResolvedTreatment[] = [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    const p = products.get(l.productId);
    if (!p || !p.is_active) throw badRequest("INVALID_PRODUCT", `Línea ${n}: producto inexistente o inactivo`);
    if (!p.is_sold) throw badRequest("NOT_SOLD", `Línea ${n}: ${p.code} no está marcado como "se vende"`);
    if (p.is_on_hold) throw badRequest("PRODUCT_ON_HOLD", `Línea ${n}: ${p.code} está retenido`);

    const unitId = l.unitId ?? p.sale_unit_id ?? p.stock_unit_id;
    let unitFactor: number;
    if (unitId === p.sale_unit_id) unitFactor = Number(p.sale_factor);
    else if (unitId === p.stock_unit_id) unitFactor = 1;
    else throw badRequest("INVALID_UNIT", `Línea ${n}: use la unidad de venta o la de almacén de ${p.code}`);

    let unitPrice = l.unitPrice ?? null;
    let priceSource: string | null = l.unitPrice !== null && l.unitPrice !== undefined ? "manual" : null;
    if (unitPrice === null) {
      const s = await suggestPrice(db, {
        priceListId: customer.price_list_id,
        productId: p.id,
        date: input.orderDate,
        currencyId,
        productRefPrice: p.sale_price === null ? null : Number(p.sale_price) * unitFactor
      });
      if (s.price === null) throw badRequest("PRICE_REQUIRED", `Línea ${n}: ${p.code} no tiene precio en lista ni de referencia; indíquelo`);
      unitPrice = s.price;
      priceSource = s.source;
    }

    const product = p.fiscal_treatment_id ? treatments.get(p.fiscal_treatment_id) ?? null : null;
    const r = resolveTreatment(product, party, customer.is_withholding_agent);
    resolved.push(r);
    lines.push({
      productId: p.id,
      unitId,
      unitFactor,
      quantity: l.quantity,
      unitPrice,
      priceSource,
      discountPct: l.discountPct,
      treatmentId: r.treatmentId,
      taxRate: r.taxRate,
      notes: l.notes ?? null
    });
  }

  const totals = computeDocument(
    lines.map((l, i) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate, withholding: resolved[i].withholding })),
    input.discountPct
  );

  return {
    header: {
      ...input,
      currencyId,
      exchangeRate: rate,
      sellerId: input.sellerId ?? customer.seller_id,
      paymentTermId: input.paymentTermId ?? customer.payment_term_id,
      deliveryTermId: input.deliveryTermId ?? customer.delivery_term_id,
      deliveryMethodId: input.deliveryMethodId ?? customer.delivery_method_id,
      deliveryAddress: input.deliveryAddress ?? customer.delivery_address
    },
    lines: lines.map((l, i) => ({ ...l, net: totals.lines[i].net, tax: totals.lines[i].tax })),
    totals
  };
}

async function persistOrder(client: pg.PoolClient, id: string, b: BuiltOrder): Promise<void> {
  const h = b.header;
  const t = b.totals;
  await client.query(
    `UPDATE sales_orders SET customer_id = $2, contact_id = $3, seller_id = $4, order_date = $5, requested_date = $6,
            warehouse_id = $7, delivery_address = $8, currency_id = $9, exchange_rate = $10, payment_term_id = $11,
            delivery_term_id = $12, delivery_method_id = $13, discount_pct = $14, subtotal = $15, discount_amount = $16,
            taxable_amount = $17, tax_amount = $18, total = $19, withholding_amount = $20, receivable = $21, taxes_detail = $22,
            customer_reference = $23, notes = $24, updated_by = fn_current_app_user()
      WHERE id = $1`,
    [
      id,
      h.customerId,
      h.contactId ?? null,
      h.sellerId,
      h.orderDate,
      h.requestedDate ?? null,
      h.warehouseId,
      h.deliveryAddress,
      h.currencyId,
      h.exchangeRate,
      h.paymentTermId,
      h.deliveryTermId,
      h.deliveryMethodId,
      h.discountPct,
      t.subtotal,
      t.discountAmount,
      t.taxableAmount,
      t.taxAmount,
      t.total,
      t.withholdingAmount,
      t.payable,
      JSON.stringify({ taxes: t.taxes, withholdings: t.withholdings }),
      h.customerReference ?? null,
      h.notes ?? null
    ]
  );
  await client.query(`DELETE FROM sales_orders_details WHERE sales_order_id = $1`, [id]);
  for (const [i, l] of b.lines.entries()) {
    await client.query(
      `INSERT INTO sales_orders_details (sales_order_id, line_no, product_id, unit_id, unit_factor, quantity, unit_price, price_source,
                                         discount_pct, fiscal_treatment_id, tax_rate, net_amount, tax_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, i + 1, l.productId, l.unitId, l.unitFactor, l.quantity, l.unitPrice, l.priceSource, l.discountPct, l.treatmentId, l.taxRate, l.net, l.tax, l.notes]
    );
  }
}

// ------------------------------------------------------------------ Reservas (FEFO)

export interface Backorder {
  lineNo: number;
  productCode: string;
  pending: number;
  reserved: number;
  missing: number;
}

/**
 * Reserva lo pendiente de cada línea (en unidad de almacén) en el almacén de la orden, por FEFO.
 * Devuelve lo que no alcanzó. Con `strict`, cualquier faltante revierte todo (allow_backorder = false).
 */
export async function reserveOrder(client: pg.PoolClient, orderId: string, strict: boolean): Promise<Backorder[]> {
  const lines = await query<{ id: string; line_no: number; product_id: string; code: string; warehouse_id: string; pending: string; reserved: string; is_stockable: boolean }>(
    `SELECT d.id, d.line_no, d.product_id, p.code, so.warehouse_id, p.is_stockable,
            GREATEST((d.quantity - d.quantity_delivered) * d.unit_factor, 0) AS pending,
            COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0) AS reserved
       FROM sales_orders_details d JOIN sales_orders so ON so.id = d.sales_order_id JOIN products p ON p.id = d.product_id
      WHERE d.sales_order_id = $1 ORDER BY d.line_no FOR UPDATE OF d`,
    [orderId],
    client
  );
  const missing: Backorder[] = [];
  for (const l of lines) {
    if (!l.is_stockable) continue;
    let need = round6(Number(l.pending) - Number(l.reserved));
    if (need <= EPS) continue;
    const lots = await query<{ lot_id: string | null; available: string }>(
      `SELECT lot_id, available FROM v_stock_available WHERE warehouse_id = $1 AND product_id = $2 ORDER BY expires_on NULLS LAST, lot_code NULLS FIRST`,
      [l.warehouse_id, l.product_id],
      client
    );
    for (const lot of lots) {
      const take = round6(Math.min(Number(lot.available), need));
      if (take <= EPS) continue;
      await client.query(
        `INSERT INTO stock_reservations (warehouse_id, product_id, lot_id, quantity, source_module, source_document_id, source_line_id, created_by)
         VALUES ($1, $2, $3, $4, 'SALES', $5, $6, fn_current_app_user())
         ON CONFLICT (source_line_id, warehouse_id, lot_id) DO UPDATE SET quantity = stock_reservations.quantity + EXCLUDED.quantity`,
        [l.warehouse_id, l.product_id, lot.lot_id, take, orderId, l.id]
      );
      need = round6(need - take);
      if (need <= EPS) break;
    }
    if (need > EPS) {
      missing.push({ lineNo: l.line_no, productCode: l.code, pending: round6(Number(l.pending)), reserved: round6(Number(l.pending) - need), missing: need });
    }
  }
  if (strict && missing.length) {
    throw new HttpError(
      409,
      "INSUFFICIENT_STOCK",
      `Sin existencia suficiente y la empresa no admite pedidos pendientes: ${missing.map((m) => `${m.productCode} (faltan ${m.missing})`).join(", ")}`,
      missing
    );
  }
  return missing;
}

const allowBackorder = async (client: pg.PoolClient) =>
  (await one<{ v: boolean }>(`SELECT COALESCE((fn_parameter('SALES', 'allow_backorder'))::text::boolean, TRUE) AS v`, [], client))!.v;

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT so.id, so.number, so.status, to_char(so.order_date, 'YYYY-MM-DD') AS "orderDate",
  to_char(so.requested_date, 'YYYY-MM-DD') AS "requestedDate",
  so.customer_id AS "customerId", c.code AS "customerCode", c.legal_name AS "customerName", c.rif AS "customerRif",
  c.is_withholding_agent AS "customerIsAgent", c.credit_limit::float AS "creditLimit",
  so.contact_id AS "contactId", cc.name AS "contactName", so.seller_id AS "sellerId", se.name AS "sellerName",
  so.warehouse_id AS "warehouseId", w.code AS "warehouseCode", so.delivery_address AS "deliveryAddress",
  so.currency_id AS "currencyId", cur.code AS "currencyCode", cur.symbol AS "currencySymbol", so.exchange_rate::float AS "exchangeRate",
  so.payment_term_id AS "paymentTermId", pt.name AS "paymentTermName", so.delivery_term_id AS "deliveryTermId",
  so.delivery_method_id AS "deliveryMethodId", so.discount_pct::float AS "discountPct",
  so.subtotal::float AS subtotal, so.discount_amount::float AS "discountAmount", so.taxable_amount::float AS "taxableAmount",
  so.tax_amount::float AS "taxAmount", so.total::float AS total, so.withholding_amount::float AS "withholdingAmount",
  so.receivable::float AS receivable, so.taxes_detail AS "taxesDetail",
  so.customer_reference AS "customerReference", so.notes, so.cancel_reason AS "cancelReason",
  so.credit_exposure::float AS "creditExposure", so.confirmed_at AS "confirmedAt",
  so.created_by AS "createdById", cu.names AS "createdBy", so.created_at AS "createdAt",
  au.names AS "approvedBy", so.approved_at AS "approvedAt", clu.names AS "closedBy", so.closed_at AS "closedAt",
  (so.requested_date < CURRENT_DATE AND so.status IN ('confirmed', 'partially_delivered')) AS "isLate"
  FROM sales_orders so
  JOIN customers c ON c.id = so.customer_id
  JOIN warehouses w ON w.id = so.warehouse_id
  JOIN catalogs_currencies cur ON cur.id = so.currency_id
  LEFT JOIN customers_contacts cc ON cc.id = so.contact_id
  LEFT JOIN sellers se ON se.id = so.seller_id
  LEFT JOIN catalogs_payment_terms pt ON pt.id = so.payment_term_id
  LEFT JOIN users cu ON cu.id = so.created_by
  LEFT JOIN users au ON au.id = so.approved_by
  LEFT JOIN users clu ON clu.id = so.closed_by`;

/** Sin view_all: solo las órdenes propias (el servidor acota, no la pantalla) */
const ownerScope = (req: Request): string | null => (req.modulePermissions?.includes("view_all") ? null : authOf(req).userId);

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  status: z.string().regex(/^[a-z_,]+$/).optional(),
  customerId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listOrders = handler({ query: listQuery }, async ({ query: q, req }) => {
  const statuses = q.status ? q.status.split(",") : null;
  const rows = await query(
    `${HEADER.replace("SELECT so.id,", "SELECT COUNT(*) OVER()::int AS total_rows, so.id,")}
      WHERE ($1::text IS NULL OR so.number ILIKE '%' || $1 || '%' OR so.customer_reference ILIKE '%' || $1 || '%'
             OR c.legal_name ILIKE '%' || $1 || '%' OR c.code ILIKE '%' || $1 || '%')
        AND ($2::text[] IS NULL OR so.status = ANY($2))
        AND ($3::uuid IS NULL OR so.customer_id = $3)
        AND ($4::date IS NULL OR so.order_date >= $4)
        AND ($5::date IS NULL OR so.order_date <= $5)
        AND ($6::uuid IS NULL OR so.created_by = $6)
      ORDER BY so.created_at DESC
      LIMIT $7 OFFSET $8`,
    [q.search || null, statuses, q.customerId ?? null, q.from ?? null, q.to ?? null, ownerScope(req), q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export async function orderDetail(id: string, db?: Db) {
  const header = await one(`${HEADER} WHERE so.id = $1`, [id], db);
  if (!header) throw notFound("Orden de venta no encontrada");
  const [lines, deliveries] = await Promise.all([
    query(
      `SELECT d.id, d.line_no AS "lineNo", d.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
              p.is_lot_controlled AS "isLotControlled", p.is_stockable AS "isStockable",
              d.unit_id AS "unitId", u.code AS "unitCode", d.unit_factor::float AS "unitFactor", su.code AS "stockUnitCode",
              d.quantity::float AS quantity, d.unit_price::float AS "unitPrice", d.price_source AS "priceSource",
              d.discount_pct::float AS "discountPct", ft.code AS "treatmentCode", d.tax_rate::float AS "taxRate",
              d.net_amount::float AS "netAmount", d.tax_amount::float AS "taxAmount",
              d.quantity_delivered::float AS "quantityDelivered", GREATEST(d.quantity - d.quantity_delivered, 0)::float AS "quantityPending",
              COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.source_line_id = d.id), 0)::float / d.unit_factor AS "quantityReserved",
              COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = d.product_id AND a.warehouse_id = so.warehouse_id), 0)::float / d.unit_factor AS available,
              COALESCE((SELECT json_agg(json_build_object('lotId', r.lot_id, 'lotCode', l.lot_code, 'expiresOn', to_char(l.expires_on, 'YYYY-MM-DD'),
                                                          'quantity', r.quantity::float) ORDER BY l.expires_on NULLS LAST)
                          FROM stock_reservations r LEFT JOIN lots l ON l.id = r.lot_id WHERE r.source_line_id = d.id), '[]') AS reservations,
              d.notes
         FROM sales_orders_details d
         JOIN sales_orders so ON so.id = d.sales_order_id
         JOIN products p ON p.id = d.product_id
         JOIN catalogs_units u ON u.id = d.unit_id
         JOIN catalogs_units su ON su.id = p.stock_unit_id
         LEFT JOIN fiscal_treatments ft ON ft.id = d.fiscal_treatment_id
        WHERE d.sales_order_id = $1 ORDER BY d.line_no`,
      [id],
      db
    ),
    query(
      `SELECT n.id, n.number, n.status, to_char(n.delivery_date, 'YYYY-MM-DD') AS "deliveryDate", n.carrier,
              m.number AS "movementNumber", u.names AS "createdBy", n.net_amount::float AS "netAmount",
              (SELECT COUNT(*) FROM delivery_notes_details dd WHERE dd.delivery_note_id = n.id)::int AS lines
         FROM delivery_notes n LEFT JOIN inventory_movements m ON m.id = n.movement_id LEFT JOIN users u ON u.id = n.created_by
        WHERE n.sales_order_id = $1 ORDER BY n.created_at`,
      [id],
      db
    )
  ]);
  return { ...header, lines, deliveries };
}

async function assertOwner(req: Request, id: string) {
  const owner = ownerScope(req);
  if (!owner) return;
  const so = await one<{ created_by: string | null }>(`SELECT created_by FROM sales_orders WHERE id = $1`, [id]);
  if (!so || so.created_by !== owner) throw notFound("Orden de venta no encontrada");
}

export const getOrder = handler({ params: idParams }, async ({ params, req }) => {
  await assertOwner(req, params.id);
  return orderDetail(params.id);
});

// ------------------------------------------------------------------ Borrador

export const previewOrder = handler({ body: orderBody }, async ({ body }) => {
  const b = await buildOrder(pool, body);
  return { exchangeRate: b.header.exchangeRate, currencyId: b.header.currencyId, lines: b.lines, totals: b.totals };
});

export const createOrder = handler({ body: orderBody }, async ({ body, req, res }) => {
  const id = await withTx(txCtx(req), async (client) => {
    const built = await buildOrder(client, body);
    const row = await one<{ id: string }>(
      `INSERT INTO sales_orders (number, customer_id, order_date, warehouse_id, currency_id, created_by, updated_by)
       VALUES (fn_next_document_number('SO'), $1, $2, $3, $4, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [body.customerId, body.orderDate, body.warehouseId, built.header.currencyId],
      client
    );
    await persistOrder(client, row!.id, built);
    return row!.id;
  });
  res.status(201);
  return orderDetail(id);
});

async function lockOrder(client: pg.PoolClient, id: string) {
  const so = await one<{ status: string; created_by: string | null; number: string; customer_id: string; total: string; exchange_rate: string }>(
    `SELECT status, created_by, number, customer_id, total, exchange_rate FROM sales_orders WHERE id = $1 FOR UPDATE`,
    [id],
    client
  );
  if (!so) throw notFound("Orden de venta no encontrada");
  return so;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "en borrador",
  pending_approval: "retenida por crédito",
  confirmed: "confirmada",
  partially_delivered: "despachada parcialmente",
  delivered: "despachada",
  closed: "cerrada",
  cancelled: "anulada"
};

function assertStatus(so: { status: string; number: string }, allowed: string[], action: string) {
  if (!allowed.includes(so.status)) {
    throw conflict("INVALID_STATUS", `No se puede ${action} la orden ${so.number}: está ${STATUS_LABEL[so.status] ?? so.status}`);
  }
}

export const updateOrder = handler({ params: idParams, body: orderBody }, async ({ params, body, req }) => {
  await assertOwner(req, params.id);
  await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["draft"], "modificar");
    await persistOrder(client, params.id, await buildOrder(client, body));
  });
  return orderDetail(params.id);
});

export const deleteOrder = handler({ params: idParams }, async ({ params, req }) => {
  await assertOwner(req, params.id);
  await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["draft"], "eliminar");
    await client.query(`DELETE FROM sales_orders WHERE id = $1`, [params.id]);
  });
  return undefined;
});

// ------------------------------------------------------------------ Transiciones

async function storedInput(client: pg.PoolClient, id: string): Promise<OrderInput> {
  const h = await one<Record<string, unknown>>(
    `SELECT customer_id, to_char(order_date, 'YYYY-MM-DD') AS order_date, to_char(requested_date, 'YYYY-MM-DD') AS requested_date,
            warehouse_id, currency_id, contact_id, seller_id, payment_term_id, delivery_term_id, delivery_method_id,
            delivery_address, discount_pct::float AS discount_pct, customer_reference, notes
       FROM sales_orders WHERE id = $1`,
    [id],
    client
  );
  const lines = await query<Record<string, unknown>>(
    `SELECT product_id, unit_id, quantity::float AS quantity, unit_price::float AS unit_price, discount_pct::float AS discount_pct, notes
       FROM sales_orders_details WHERE sales_order_id = $1 ORDER BY line_no`,
    [id],
    client
  );
  return orderBody.parse({
    customerId: h!.customer_id,
    orderDate: h!.order_date,
    requestedDate: h!.requested_date,
    warehouseId: h!.warehouse_id,
    currencyId: h!.currency_id,
    contactId: h!.contact_id,
    sellerId: h!.seller_id,
    paymentTermId: h!.payment_term_id,
    deliveryTermId: h!.delivery_term_id,
    deliveryMethodId: h!.delivery_method_id,
    deliveryAddress: h!.delivery_address,
    discountPct: h!.discount_pct,
    customerReference: h!.customer_reference,
    notes: h!.notes,
    lines: lines.map((l) => ({ productId: l.product_id, unitId: l.unit_id, quantity: l.quantity, unitPrice: l.unit_price, discountPct: l.discount_pct, notes: l.notes }))
  });
}

/** Exposición de crédito en moneda base: órdenes abiertas del cliente (incluida esta) */
async function creditCheck(client: pg.PoolClient, id: string) {
  return (await one<{ limit: string | null; exposure: string }>(
    `SELECT c.credit_limit AS limit,
            (SELECT COALESCE(SUM(o.total * o.exchange_rate), 0) FROM sales_orders o
              WHERE o.customer_id = c.id AND (o.id = $1 OR o.status IN ('pending_approval', 'confirmed', 'partially_delivered'))) AS exposure
       FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1`,
    [id],
    client
  ))!;
}

export const confirmOrder = handler({ params: idParams }, async ({ params, req }) => {
  await assertOwner(req, params.id);
  const result = await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["draft"], "confirmar");
    await persistOrder(client, params.id, await buildOrder(client, await storedInput(client, params.id)));
    const credit = await creditCheck(client, params.id);
    if (credit.limit !== null && Number(credit.exposure) > Number(credit.limit) + 0.005) {
      await client.query(
        `UPDATE sales_orders SET status = 'pending_approval', credit_exposure = $2, updated_by = fn_current_app_user() WHERE id = $1`,
        [params.id, credit.exposure]
      );
      return { backorder: [] as Backorder[], creditHold: true };
    }
    const backorder = await reserveOrder(client, params.id, !(await allowBackorder(client)));
    await client.query(
      `UPDATE sales_orders SET status = 'confirmed', confirmed_at = NOW(), credit_exposure = $2, updated_by = fn_current_app_user() WHERE id = $1`,
      [params.id, credit.exposure]
    );
    return { backorder, creditHold: false };
  });
  return { ...(await orderDetail(params.id)), ...result };
});

export const approveOrder = handler({ params: idParams }, async ({ params, req }) => {
  const me = authOf(req).userId;
  const backorder = await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["pending_approval"], "aprobar");
    if (so.created_by === me) throw forbidden("SELF_APPROVAL", "Segregación de funciones: quien creó la orden no puede aprobar su crédito");
    const bo = await reserveOrder(client, params.id, !(await allowBackorder(client)));
    await client.query(
      `UPDATE sales_orders SET status = 'confirmed', confirmed_at = NOW(), approved_by = fn_current_app_user(), approved_at = NOW(),
              updated_by = fn_current_app_user() WHERE id = $1`,
      [params.id]
    );
    return bo;
  });
  return { ...(await orderDetail(params.id)), backorder, creditHold: false };
});

const reasonBody = z.object({ reason: z.string().trim().min(3, "Indique el motivo").max(400) });

export const returnToDraft = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["pending_approval"], "devolver a borrador");
    await client.query(
      `UPDATE sales_orders SET status = 'draft', notes = concat_ws(E'\\n', notes, 'Crédito no aprobado: ' || $2), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, body.reason]
    );
  });
  return orderDetail(params.id);
});

/** Vuelve a reservar lo pendiente (p. ej. cuando entra existencia nueva) */
export const reserveAgain = handler({ params: idParams }, async ({ params, req }) => {
  await assertOwner(req, params.id);
  const backorder = await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["confirmed", "partially_delivered"], "reservar");
    return reserveOrder(client, params.id, false);
  });
  return { ...(await orderDetail(params.id)), backorder };
});

export const cancelOrder = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await assertOwner(req, params.id);
  await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    if (so.status === "partially_delivered" || so.status === "delivered") {
      throw conflict("HAS_DELIVERIES", "La orden ya tiene despachos: ciérrela en lugar de anularla");
    }
    assertStatus(so, ["draft", "pending_approval", "confirmed"], "anular");
    await client.query(`DELETE FROM stock_reservations WHERE source_document_id = $1`, [params.id]);
    await client.query(`UPDATE sales_orders SET status = 'cancelled', cancel_reason = $2, updated_by = fn_current_app_user() WHERE id = $1`, [
      params.id,
      body.reason
    ]);
  });
  return orderDetail(params.id);
});

export const closeOrder = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const so = await lockOrder(client, params.id);
    assertStatus(so, ["partially_delivered"], "cerrar");
    await client.query(`DELETE FROM stock_reservations WHERE source_document_id = $1`, [params.id]);
    await client.query(
      `UPDATE sales_orders SET status = 'closed', closed_by = fn_current_app_user(), closed_at = NOW(),
              notes = concat_ws(E'\\n', notes, 'Cerrada con pendientes: ' || $2), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, body.reason]
    );
  });
  return orderDetail(params.id);
});

/** Precio sugerido para el formulario (misma regla que el guardado) */
export const priceSuggestion = handler(
  { query: z.object({ customerId: z.uuid(), productId: z.uuid(), currencyId: z.uuid(), date: z.iso.date(), unitId: z.uuid().optional() }) },
  async ({ query: q }) => {
    const c = await one<{ price_list_id: string | null }>(`SELECT price_list_id FROM customers WHERE id = $1`, [q.customerId]);
    const p = await one<{ sale_price: string | null; sale_unit_id: string | null; sale_factor: string; stock_unit_id: string }>(
      `SELECT sale_price, sale_unit_id, sale_factor, stock_unit_id FROM products WHERE id = $1`,
      [q.productId]
    );
    if (!c || !p) throw notFound();
    const unitId = q.unitId ?? p.sale_unit_id ?? p.stock_unit_id;
    const factor = unitId === p.sale_unit_id ? Number(p.sale_factor) : 1;
    try {
      return await suggestPrice(pool, {
        priceListId: c.price_list_id,
        productId: q.productId,
        date: q.date,
        currencyId: q.currencyId,
        productRefPrice: p.sale_price === null ? null : Number(p.sale_price) * factor
      });
    } catch (e) {
      if (e instanceof HttpError && e.code === "NO_EXCHANGE_RATE") return { price: null, source: null, warning: e.message };
      throw e;
    }
  }
);
