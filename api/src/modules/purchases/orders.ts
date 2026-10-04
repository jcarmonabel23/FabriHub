/**
 * @project FabriHub - API
 * @file src/modules/purchases/orders.ts
 * @description Órdenes de compra (PUR_ORDERS) — tesis: Clases Orden de Compras y Detalles
 *
 * @overview
 * Máquina de estados (tesis: Estado de la Orden):
 *
 *   draft ──submit──▶ pending_approval ──approve──▶ approved ──recepción──▶ partially_received ──▶ received
 *     ▲                    │ return-to-draft            │                         │ close
 *     └────────────────────┘                            └──── cancel (sin recepciones)   ▼
 *                                                                                      closed
 *
 *  - Solo el BORRADOR se edita. Desde que se envía, la orden es un documento: se anula o se cierra.
 *  - Segregación de funciones: quien CREÓ la orden no puede APROBARLA (403 SELF_APPROVAL).
 *  - Con el parámetro PURCHASES.require_po_approval apagado, enviar = aprobar.
 *  - Los montos se recalculan con el motor fiscal en cada guardado y al enviar (tasa de cambio y
 *    tratamientos vigentes en la fecha de la orden) y quedan como foto del documento.
 */

import { z } from "zod";
import type pg from "pg";
import { one, pool, query, withTx, type Db } from "../../db.js";
import { HttpError, badRequest, conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";
import { computeDocument, resolveTreatment, type DocumentResult, type ResolvedTreatment } from "../taxes/document.js";
import { suggestPrice } from "../pricing/priceLists.js";
import { appliesWithholdings, exchangeRate, loadTreatments } from "./fiscal.js";

// ------------------------------------------------------------------ Entrada

const lineSchema = z.object({
  productId: z.uuid(),
  unitId: z.uuid().nullish(),
  quantity: z.number().positive().max(1e12),
  unitPrice: z.number().min(0).max(1e12).nullish(),
  discountPct: z.number().min(0).max(100).default(0),
  expectedDate: z.iso.date().nullish(),
  notes: z.string().trim().max(400).nullish()
});

export const orderBody = z.object({
  supplierId: z.uuid(),
  orderDate: z.iso.date(),
  expectedDate: z.iso.date().nullish(),
  warehouseId: z.uuid(),
  currencyId: z.uuid().nullish(),
  contactId: z.uuid().nullish(),
  buyerId: z.uuid().nullish(),
  paymentTermId: z.uuid().nullish(),
  deliveryTermId: z.uuid().nullish(),
  deliveryMethodId: z.uuid().nullish(),
  deliveryAddress: z.string().trim().max(400).nullish(),
  discountPct: z.number().min(0).max(100).default(0),
  supplierReference: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(800).nullish(),
  lines: z.array(lineSchema).min(1, "Agregue al menos una línea").max(200)
});
type OrderInput = z.infer<typeof orderBody>;

// ------------------------------------------------------------------ Cálculo (preview y guardado usan lo mismo)

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
  expectedDate: string | null;
  notes: string | null;
}

interface BuiltOrder {
  header: OrderInput & {
    currencyId: string;
    exchangeRate: number;
    buyerId: string | null;
    paymentTermId: string | null;
    deliveryTermId: string | null;
    deliveryMethodId: string | null;
  };
  lines: BuiltLine[];
  totals: DocumentResult;
}

interface ProductRow {
  id: string;
  code: string;
  is_active: boolean;
  is_purchased: boolean;
  stock_unit_id: string;
  purchase_unit_id: string | null;
  purchase_factor: string;
  fiscal_treatment_id: string | null;
  purchase_price: string | null;
}

export async function buildOrder(db: Db | pg.PoolClient, input: OrderInput): Promise<BuiltOrder> {
  const supplier = await one<{
    is_active: boolean;
    currency_id: string | null;
    buyer_id: string | null;
    payment_term_id: string | null;
    delivery_term_id: string | null;
    delivery_method_id: string | null;
    price_list_id: string | null;
    fiscal_treatment_id: string | null;
  }>(
    `SELECT is_active, currency_id, buyer_id, payment_term_id, delivery_term_id, delivery_method_id, price_list_id, fiscal_treatment_id
       FROM suppliers WHERE id = $1`,
    [input.supplierId],
    db
  );
  if (!supplier) throw badRequest("INVALID_SUPPLIER", "Proveedor inexistente");
  if (!supplier.is_active) throw badRequest("INACTIVE_SUPPLIER", "El proveedor está inactivo");

  const base = await one<{ id: string }>(`SELECT base_currency_id AS id FROM company WHERE id = 1`, [], db);
  const currencyId = input.currencyId ?? supplier.currency_id ?? base!.id;
  const rate = await exchangeRate(db, currencyId, input.orderDate);

  const products = new Map(
    (
      await query<ProductRow>(
        `SELECT id, code, is_active, is_purchased, stock_unit_id, purchase_unit_id, purchase_factor, fiscal_treatment_id, purchase_price
           FROM products WHERE id = ANY($1)`,
        [[...new Set(input.lines.map((l) => l.productId))]],
        db
      )
    ).map((p) => [p.id, p])
  );

  const treatments = await loadTreatments(
    db,
    [supplier.fiscal_treatment_id ?? "", ...[...products.values()].map((p) => p.fiscal_treatment_id ?? "")],
    input.orderDate
  );
  const party = supplier.fiscal_treatment_id ? treatments.get(supplier.fiscal_treatment_id) ?? null : null;
  const withholdings = await appliesWithholdings(db);

  const lines: Omit<BuiltLine, "net" | "tax">[] = [];
  const resolved: ResolvedTreatment[] = [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    const p = products.get(l.productId);
    if (!p || !p.is_active) throw badRequest("INVALID_PRODUCT", `Línea ${n}: producto inexistente o inactivo`);
    if (!p.is_purchased) throw badRequest("NOT_PURCHASED", `Línea ${n}: ${p.code} no está marcado como "se compra"`);

    const unitId = l.unitId ?? p.purchase_unit_id ?? p.stock_unit_id;
    let unitFactor: number;
    if (unitId === p.purchase_unit_id) unitFactor = Number(p.purchase_factor);
    else if (unitId === p.stock_unit_id) unitFactor = 1;
    else throw badRequest("INVALID_UNIT", `Línea ${n}: use la unidad de compra o la de almacén de ${p.code}`);

    let unitPrice = l.unitPrice ?? null;
    let priceSource: string | null = l.unitPrice !== null && l.unitPrice !== undefined ? "manual" : null;
    if (unitPrice === null) {
      const s = await suggestPrice(db, {
        priceListId: supplier.price_list_id,
        productId: p.id,
        date: input.orderDate,
        currencyId,
        // El precio de referencia del producto es por unidad de almacén: se lleva a la unidad de la línea.
        productRefPrice: p.purchase_price === null ? null : Number(p.purchase_price) * unitFactor
      });
      if (s.price === null) throw badRequest("PRICE_REQUIRED", `Línea ${n}: ${p.code} no tiene precio en lista ni de referencia; indíquelo`);
      unitPrice = s.price;
      priceSource = s.source;
    }

    const product = p.fiscal_treatment_id ? treatments.get(p.fiscal_treatment_id) ?? null : null;
    const r = resolveTreatment(product, party, withholdings);
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
      expectedDate: l.expectedDate ?? null,
      notes: l.notes ?? null
    });
  }

  const totals = computeDocument(
    lines.map((l, i) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      taxRate: l.taxRate,
      withholding: resolved[i].withholding
    })),
    input.discountPct
  );

  return {
    header: {
      ...input,
      currencyId,
      exchangeRate: rate,
      buyerId: input.buyerId ?? supplier.buyer_id,
      paymentTermId: input.paymentTermId ?? supplier.payment_term_id,
      deliveryTermId: input.deliveryTermId ?? supplier.delivery_term_id,
      deliveryMethodId: input.deliveryMethodId ?? supplier.delivery_method_id
    },
    lines: lines.map((l, i) => ({ ...l, net: totals.lines[i].net, tax: totals.lines[i].tax })),
    totals
  };
}

async function persistOrder(client: pg.PoolClient, id: string, b: BuiltOrder): Promise<void> {
  const h = b.header;
  const t = b.totals;
  await client.query(
    `UPDATE purchase_orders SET supplier_id = $2, contact_id = $3, buyer_id = $4, order_date = $5, expected_date = $6,
            warehouse_id = $7, delivery_address = $8, currency_id = $9, exchange_rate = $10, payment_term_id = $11,
            delivery_term_id = $12, delivery_method_id = $13, discount_pct = $14, subtotal = $15, discount_amount = $16,
            taxable_amount = $17, tax_amount = $18, total = $19, withholding_amount = $20, payable = $21, taxes_detail = $22,
            supplier_reference = $23, notes = $24, updated_by = fn_current_app_user()
      WHERE id = $1`,
    [
      id,
      h.supplierId,
      h.contactId ?? null,
      h.buyerId,
      h.orderDate,
      h.expectedDate ?? null,
      h.warehouseId,
      h.deliveryAddress ?? null,
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
      h.supplierReference ?? null,
      h.notes ?? null
    ]
  );
  await client.query(`DELETE FROM purchase_orders_details WHERE purchase_order_id = $1`, [id]);
  for (const [i, l] of b.lines.entries()) {
    await client.query(
      `INSERT INTO purchase_orders_details (purchase_order_id, line_no, product_id, unit_id, unit_factor, quantity, unit_price,
                                            discount_pct, fiscal_treatment_id, tax_rate, net_amount, tax_amount, expected_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, i + 1, l.productId, l.unitId, l.unitFactor, l.quantity, l.unitPrice, l.discountPct, l.treatmentId, l.taxRate, l.net, l.tax, l.expectedDate, l.notes]
    );
  }
}

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT po.id, po.number, po.status, to_char(po.order_date, 'YYYY-MM-DD') AS "orderDate",
  to_char(po.expected_date, 'YYYY-MM-DD') AS "expectedDate",
  po.supplier_id AS "supplierId", s.code AS "supplierCode", s.legal_name AS "supplierName", s.rif AS "supplierRif",
  po.contact_id AS "contactId", sc.name AS "contactName", po.buyer_id AS "buyerId", b.name AS "buyerName",
  po.warehouse_id AS "warehouseId", w.code AS "warehouseCode", po.delivery_address AS "deliveryAddress",
  po.currency_id AS "currencyId", cur.code AS "currencyCode", cur.symbol AS "currencySymbol", po.exchange_rate::float AS "exchangeRate",
  po.payment_term_id AS "paymentTermId", pt.name AS "paymentTermName", po.delivery_term_id AS "deliveryTermId",
  po.delivery_method_id AS "deliveryMethodId", po.discount_pct::float AS "discountPct",
  po.subtotal::float AS subtotal, po.discount_amount::float AS "discountAmount", po.taxable_amount::float AS "taxableAmount",
  po.tax_amount::float AS "taxAmount", po.total::float AS total, po.withholding_amount::float AS "withholdingAmount",
  po.payable::float AS payable, po.taxes_detail AS "taxesDetail",
  po.supplier_reference AS "supplierReference", po.notes, po.cancel_reason AS "cancelReason",
  po.created_by AS "createdById", cu.names AS "createdBy", po.created_at AS "createdAt",
  po.submitted_at AS "submittedAt", au.names AS "approvedBy", po.approved_at AS "approvedAt",
  clu.names AS "closedBy", po.closed_at AS "closedAt"
  FROM purchase_orders po
  JOIN suppliers s ON s.id = po.supplier_id
  JOIN warehouses w ON w.id = po.warehouse_id
  JOIN catalogs_currencies cur ON cur.id = po.currency_id
  LEFT JOIN suppliers_contacts sc ON sc.id = po.contact_id
  LEFT JOIN buyers b ON b.id = po.buyer_id
  LEFT JOIN catalogs_payment_terms pt ON pt.id = po.payment_term_id
  LEFT JOIN users cu ON cu.id = po.created_by
  LEFT JOIN users au ON au.id = po.approved_by
  LEFT JOIN users clu ON clu.id = po.closed_by`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  status: z.string().regex(/^[a-z_,]+$/).optional(),
  supplierId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listOrders = handler({ query: listQuery }, async ({ query: q }) => {
  const statuses = q.status ? q.status.split(",") : null;
  const rows = await query(
    `${HEADER.replace("SELECT po.id,", "SELECT COUNT(*) OVER()::int AS total_rows, po.id,")}
      WHERE ($1::text IS NULL OR po.number ILIKE '%' || $1 || '%' OR po.supplier_reference ILIKE '%' || $1 || '%'
             OR s.legal_name ILIKE '%' || $1 || '%')
        AND ($2::text[] IS NULL OR po.status = ANY($2))
        AND ($3::uuid IS NULL OR po.supplier_id = $3)
        AND ($4::date IS NULL OR po.order_date >= $4)
        AND ($5::date IS NULL OR po.order_date <= $5)
      ORDER BY po.created_at DESC
      LIMIT $6 OFFSET $7`,
    [q.search || null, statuses, q.supplierId ?? null, q.from ?? null, q.to ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export async function orderDetail(id: string, db?: Db) {
  const header = await one(`${HEADER} WHERE po.id = $1`, [id], db);
  if (!header) throw notFound("Orden de compra no encontrada");
  const [lines, receptions] = await Promise.all([
    query(
      `SELECT d.id, d.line_no AS "lineNo", d.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
              p.is_lot_controlled AS "isLotControlled", p.is_stockable AS "isStockable", p.shelf_life_days AS "shelfLifeDays",
              d.unit_id AS "unitId", u.code AS "unitCode", d.unit_factor::float AS "unitFactor", su.code AS "stockUnitCode",
              d.quantity::float AS quantity, d.unit_price::float AS "unitPrice", d.discount_pct::float AS "discountPct",
              ft.code AS "treatmentCode", d.tax_rate::float AS "taxRate", d.net_amount::float AS "netAmount",
              d.tax_amount::float AS "taxAmount", d.quantity_received::float AS "quantityReceived",
              GREATEST(d.quantity - d.quantity_received, 0)::float AS "quantityPending",
              to_char(d.expected_date, 'YYYY-MM-DD') AS "expectedDate", d.notes
         FROM purchase_orders_details d
         JOIN products p ON p.id = d.product_id
         JOIN catalogs_units u ON u.id = d.unit_id
         JOIN catalogs_units su ON su.id = p.stock_unit_id
         LEFT JOIN fiscal_treatments ft ON ft.id = d.fiscal_treatment_id
        WHERE d.purchase_order_id = $1 ORDER BY d.line_no`,
      [id],
      db
    ),
    query(
      `SELECT r.id, r.number, r.kind, r.status, to_char(r.reception_date, 'YYYY-MM-DD') AS "receptionDate", r.delivery_note AS "deliveryNote",
              m.number AS "movementNumber", u.names AS "createdBy",
              (SELECT COUNT(*) FROM receptions_details rd WHERE rd.reception_id = r.id)::int AS lines
         FROM receptions r LEFT JOIN inventory_movements m ON m.id = r.movement_id LEFT JOIN users u ON u.id = r.created_by
        WHERE r.purchase_order_id = $1 ORDER BY r.created_at`,
      [id],
      db
    )
  ]);
  return { ...header, lines, receptions };
}

export const getOrder = handler({ params: idParams }, ({ params }) => orderDetail(params.id));

// ------------------------------------------------------------------ Borrador

export const previewOrder = handler({ body: orderBody }, async ({ body }) => {
  const b = await buildOrder(pool, body);
  return { exchangeRate: b.header.exchangeRate, currencyId: b.header.currencyId, lines: b.lines, totals: b.totals };
});

export const createOrder = handler({ body: orderBody }, async ({ body, req, res }) => {
  const id = await withTx(txCtx(req), async (client) => {
    const built = await buildOrder(client, body);
    const row = await one<{ id: string }>(
      `INSERT INTO purchase_orders (number, supplier_id, order_date, warehouse_id, currency_id, created_by, updated_by)
       VALUES (fn_next_document_number('PO'), $1, $2, $3, $4, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [body.supplierId, body.orderDate, body.warehouseId, built.header.currencyId],
      client
    );
    await persistOrder(client, row!.id, built);
    return row!.id;
  });
  res.status(201);
  return orderDetail(id);
});

async function lockOrder(client: pg.PoolClient, id: string) {
  const po = await one<{ status: string; created_by: string | null; number: string }>(
    `SELECT status, created_by, number FROM purchase_orders WHERE id = $1 FOR UPDATE`,
    [id],
    client
  );
  if (!po) throw notFound("Orden de compra no encontrada");
  return po;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "borrador",
  pending_approval: "pendiente de aprobación",
  approved: "aprobada",
  partially_received: "con recepción parcial",
  received: "recibida",
  closed: "cerrada",
  cancelled: "anulada"
};

function assertStatus(po: { status: string; number: string }, allowed: string[], action: string) {
  if (!allowed.includes(po.status)) {
    throw conflict("INVALID_STATUS", `No se puede ${action} la orden ${po.number}: está ${STATUS_LABEL[po.status] ?? po.status}`);
  }
}

export const updateOrder = handler({ params: idParams, body: orderBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    assertStatus(po, ["draft"], "modificar");
    await persistOrder(client, params.id, await buildOrder(client, body));
  });
  return orderDetail(params.id);
});

export const deleteOrder = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    assertStatus(po, ["draft"], "eliminar");
    await client.query(`DELETE FROM purchase_orders WHERE id = $1`, [params.id]);
  });
  return undefined;
});

// ------------------------------------------------------------------ Transiciones

/** Reconstruye la entrada de buildOrder desde lo guardado, para recalcular al enviar */
async function storedInput(client: pg.PoolClient, id: string): Promise<OrderInput> {
  const h = await one<Record<string, unknown>>(
    `SELECT supplier_id, to_char(order_date, 'YYYY-MM-DD') AS order_date, to_char(expected_date, 'YYYY-MM-DD') AS expected_date,
            warehouse_id, currency_id, contact_id, buyer_id, payment_term_id, delivery_term_id, delivery_method_id,
            delivery_address, discount_pct::float AS discount_pct, supplier_reference, notes
       FROM purchase_orders WHERE id = $1`,
    [id],
    client
  );
  const lines = await query<Record<string, unknown>>(
    `SELECT product_id, unit_id, quantity::float AS quantity, unit_price::float AS unit_price, discount_pct::float AS discount_pct,
            to_char(expected_date, 'YYYY-MM-DD') AS expected_date, notes
       FROM purchase_orders_details WHERE purchase_order_id = $1 ORDER BY line_no`,
    [id],
    client
  );
  return orderBody.parse({
    supplierId: h!.supplier_id,
    orderDate: h!.order_date,
    expectedDate: h!.expected_date,
    warehouseId: h!.warehouse_id,
    currencyId: h!.currency_id,
    contactId: h!.contact_id,
    buyerId: h!.buyer_id,
    paymentTermId: h!.payment_term_id,
    deliveryTermId: h!.delivery_term_id,
    deliveryMethodId: h!.delivery_method_id,
    deliveryAddress: h!.delivery_address,
    discountPct: h!.discount_pct,
    supplierReference: h!.supplier_reference,
    notes: h!.notes,
    lines: lines.map((l) => ({
      productId: l.product_id,
      unitId: l.unit_id,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      discountPct: l.discount_pct,
      expectedDate: l.expected_date,
      notes: l.notes
    }))
  });
}

export const submitOrder = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    assertStatus(po, ["draft"], "enviar");
    await persistOrder(client, params.id, await buildOrder(client, await storedInput(client, params.id)));
    const needsApproval = await one<{ v: boolean }>(
      `SELECT COALESCE((fn_parameter('PURCHASES', 'require_po_approval'))::text::boolean, TRUE) AS v`,
      [],
      client
    );
    await client.query(
      `UPDATE purchase_orders SET status = $2::text, submitted_at = NOW(),
              approved_at = CASE WHEN $2::text = 'approved' THEN NOW() END, updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, needsApproval?.v ? "pending_approval" : "approved"]
    );
  });
  return orderDetail(params.id);
});

export const approveOrder = handler(
  { params: idParams, body: z.object({ notes: z.string().trim().max(400).nullish() }) },
  async ({ params, req }) => {
    const me = authOf(req).userId;
    await withTx(txCtx(req), async (client) => {
      const po = await lockOrder(client, params.id);
      assertStatus(po, ["pending_approval"], "aprobar");
      if (po.created_by === me) {
        throw forbidden("SELF_APPROVAL", "Segregación de funciones: quien creó la orden no puede aprobarla");
      }
      await client.query(
        `UPDATE purchase_orders SET status = 'approved', approved_by = fn_current_app_user(), approved_at = NOW(),
                updated_by = fn_current_app_user() WHERE id = $1`,
        [params.id]
      );
    });
    return orderDetail(params.id);
  }
);

const reasonBody = z.object({ reason: z.string().trim().min(3, "Indique el motivo").max(400) });

export const returnToDraft = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    assertStatus(po, ["pending_approval"], "devolver a borrador");
    await client.query(
      `UPDATE purchase_orders SET status = 'draft', submitted_at = NULL,
              notes = concat_ws(E'\\n', notes, 'Devuelta a borrador: ' || $2), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, body.reason]
    );
  });
  return orderDetail(params.id);
});

export const cancelOrder = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    if (po.status === "partially_received" || po.status === "received") {
      throw conflict("HAS_RECEPTIONS", "La orden ya tiene mercancía recibida: ciérrela en lugar de anularla");
    }
    assertStatus(po, ["draft", "pending_approval", "approved"], "anular");
    const received = await one(
      `SELECT 1 FROM purchase_orders_details WHERE purchase_order_id = $1 AND quantity_received > 0 LIMIT 1`,
      [params.id],
      client
    );
    if (received) throw conflict("HAS_RECEPTIONS", "La orden ya tiene mercancía recibida: ciérrela en lugar de anularla");
    await client.query(
      `UPDATE purchase_orders SET status = 'cancelled', cancel_reason = $2, updated_by = fn_current_app_user() WHERE id = $1`,
      [params.id, body.reason]
    );
  });
  return orderDetail(params.id);
});

export const closeOrder = handler({ params: idParams, body: reasonBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const po = await lockOrder(client, params.id);
    assertStatus(po, ["partially_received"], "cerrar");
    await client.query(
      `UPDATE purchase_orders SET status = 'closed', closed_by = fn_current_app_user(), closed_at = NOW(),
              notes = concat_ws(E'\\n', notes, 'Cerrada con pendientes: ' || $2), updated_by = fn_current_app_user()
        WHERE id = $1`,
      [params.id, body.reason]
    );
  });
  return orderDetail(params.id);
});

/** Precio sugerido para el formulario (misma regla que usa el guardado) */
export const priceSuggestion = handler(
  {
    query: z.object({
      supplierId: z.uuid(),
      productId: z.uuid(),
      currencyId: z.uuid(),
      date: z.iso.date(),
      unitId: z.uuid().optional()
    })
  },
  async ({ query: q }) => {
    const s = await one<{ price_list_id: string | null }>(`SELECT price_list_id FROM suppliers WHERE id = $1`, [q.supplierId]);
    const p = await one<{ purchase_price: string | null; purchase_unit_id: string | null; purchase_factor: string; stock_unit_id: string }>(
      `SELECT purchase_price, purchase_unit_id, purchase_factor, stock_unit_id FROM products WHERE id = $1`,
      [q.productId]
    );
    if (!s || !p) throw notFound();
    const unitId = q.unitId ?? p.purchase_unit_id ?? p.stock_unit_id;
    const factor = unitId === p.purchase_unit_id ? Number(p.purchase_factor) : 1;
    try {
      return await suggestPrice(pool, {
        priceListId: s.price_list_id,
        productId: q.productId,
        date: q.date,
        currencyId: q.currencyId,
        productRefPrice: p.purchase_price === null ? null : Number(p.purchase_price) * factor
      });
    } catch (e) {
      if (e instanceof HttpError && e.code === "NO_EXCHANGE_RATE") return { price: null, source: null, warning: e.message };
      throw e;
    }
  }
);
