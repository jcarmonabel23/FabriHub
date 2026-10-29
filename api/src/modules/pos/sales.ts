/**
 * @project FabriHub - API
 * @file src/modules/pos/sales.ts
 * @description Ventas de mostrador (POS_SALES): catálogo, clientes, cotización, venta y anulación
 *
 * @overview
 * Una venta se confirma en UNA transacción:
 *  1. Precios e IVA los calcula el servidor con el motor de las órdenes de venta (buildOrder):
 *     lista de precios de la CAJA, tratamientos fiscales y descuentos. Sin retenciones.
 *  2. Salida de inventario VENTA_POS del almacén de la caja, por FEFO sobre lo libre (no reservado)
 *     de lotes aprobados y vigentes. Si no alcanza, la venta se rechaza.
 *  3. Pagos combinados (efectivo Bs o divisas, punto de venta, pago móvil, transferencia), cada uno
 *     con su moneda y la tasa del día. Solo el efectivo da vuelto. IGTF (si POS.igtf_enabled)
 *     sobre la parte del total pagada en divisas. Número de comprobante del correlativo de la caja.
 *
 * Un descuento (de línea combinado con el global) mayor a POS.max_discount_pct exige supervisor;
 * anular siempre lo exige y solo se anula mientras el turno sigue abierto (reversa el inventario).
 * El comprobante NO es una factura fiscal.
 */

import type { Request } from "express";
import type pg from "pg";
import { z } from "zod";
import { one, pool, query, withTx, type Db } from "../../db.js";
import { HttpError, badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";
import { imageUrls } from "../files/images.js";
import { exchangeRate } from "../purchases/fiscal.js";
import { buildOrder, type BuiltOrder, type OrderInput } from "../sales/orders.js";
import { METHODS, lockOwnSession } from "./sessions.js";
import { authorizeSupervisor, supervisorSchema } from "./supervisor.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-9;
const CENT = 0.005;

export const FINAL_CONSUMER = { code: "CONSUMIDOR_FINAL", name: "Consumidor final", rif: "V-00000000-0" };

/** null = todas; si no, solo las vendidas por el usuario */
const ownerScope = (req: Request) => (req.modulePermissions?.includes("view_all") ? null : authOf(req).userId);

const today = async (db: Db) => (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`, [], db))!.d;

// ------------------------------------------------------------------ Catálogo

const catalogQuery = z.object({
  terminalId: z.uuid(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40)
});

/**
 * Productos vendibles con imagen, precio (moneda base, sin IVA), alícuota de IVA, disponible en el
 * almacén de la caja y código de barras. El código de barras exacto y el código van primero; luego
 * por parecido del nombre (índice pg_trgm).
 */
export const posCatalog = handler({ query: catalogQuery }, async ({ query: q }) => {
  const t = await one<{ warehouse_id: string; price_list_id: string | null }>(
    `SELECT warehouse_id, price_list_id FROM pos_terminals WHERE id = $1 AND is_active`,
    [q.terminalId]
  );
  if (!t) throw notFound("Caja no encontrada o inactiva");
  const rows = await query<{ imageKey: string | null }>(
    `WITH base AS (SELECT base_currency_id AS id FROM companies WHERE id = fn_current_company())
     SELECT p.id, p.code, p.name, p.barcode, fi.storage_key AS "imageKey", p.is_stockable AS "isStockable",
            COALESCE(p.sale_unit_id, p.stock_unit_id) AS "unitId", COALESCE(su.code, u.code) AS "unitCode",
            CASE WHEN p.sale_unit_id IS NOT NULL THEN p.sale_factor ELSE 1 END::float AS "unitFactor",
            ROUND(COALESCE(
              (SELECT COALESCE(CASE WHEN i.promo_price IS NOT NULL AND CURRENT_DATE BETWEEN i.promo_from AND i.promo_to THEN i.promo_price END, i.price)
                      * CASE WHEN l.currency_id = (SELECT id FROM base) THEN 1
                             ELSE (SELECT r.rate FROM currencies_rates r WHERE r.currency_id = l.currency_id AND r.rate_date <= CURRENT_DATE
                                    ORDER BY r.rate_date DESC LIMIT 1) END
                 FROM price_lists_items i JOIN price_lists l ON l.id = i.price_list_id
                WHERE i.price_list_id = $2 AND i.product_id = p.id AND l.is_active
                  AND (l.valid_from IS NULL OR l.valid_from <= CURRENT_DATE) AND (l.valid_to IS NULL OR l.valid_to >= CURRENT_DATE)),
              p.sale_price * CASE WHEN p.sale_unit_id IS NOT NULL THEN p.sale_factor ELSE 1 END), 4)::float AS price,
            (SELECT CASE WHEN i.promo_price IS NOT NULL AND CURRENT_DATE BETWEEN i.promo_from AND i.promo_to THEN TRUE ELSE FALSE END
               FROM price_lists_items i WHERE i.price_list_id = $2 AND i.product_id = p.id) AS "isPromo",
            COALESCE(tr.rate, 0)::float AS "taxRate",
            CASE WHEN p.is_stockable
                 THEN COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.warehouse_id = $1 AND a.product_id = p.id), 0)
                      / CASE WHEN p.sale_unit_id IS NOT NULL THEN p.sale_factor ELSE 1 END
            END::float AS available
       FROM products p
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN catalogs_units su ON su.id = p.sale_unit_id
       LEFT JOIN files fi ON fi.id = p.image_file_id
       LEFT JOIN fiscal_treatments ft ON ft.id = p.fiscal_treatment_id
       LEFT JOIN taxes_rates tr ON tr.id = ft.tax_rate_id
      WHERE p.is_active AND p.is_sold AND NOT p.is_on_hold
        AND ($3::text IS NULL OR p.barcode = $3 OR p.code ILIKE '%' || $3 || '%' OR p.name ILIKE '%' || $3 || '%')
      ORDER BY (p.barcode = $3) DESC NULLS LAST, (p.code ILIKE $3) DESC NULLS LAST,
               CASE WHEN $3::text IS NULL THEN 0 ELSE similarity(p.name, $3) END DESC, p.name
      LIMIT $4`,
    [t.warehouse_id, t.price_list_id, q.search || null, q.limit]
  );
  return rows.map(({ imageKey, ...p }) => ({ ...p, image: imageUrls(imageKey) }));
});

// ------------------------------------------------------------------ Clientes

/** «Consumidor final» de la empresa activa (se crea la primera vez) */
export async function finalConsumerId(db: Db): Promise<string> {
  await query(
    `INSERT INTO customers (code, legal_name, rif, notes) VALUES ($1, $2, $3, 'Cliente genérico de las ventas de mostrador')
     ON CONFLICT DO NOTHING`,
    [FINAL_CONSUMER.code, FINAL_CONSUMER.name, FINAL_CONSUMER.rif],
    db
  );
  const row = await one<{ id: string }>(`SELECT id FROM customers WHERE code = $1`, [FINAL_CONSUMER.code], db);
  if (!row) throw conflict("FINAL_CONSUMER_MISSING", "No se pudo preparar el cliente «Consumidor final»");
  return row.id;
}

/** Normaliza un RIF o cédula escrito de cualquier forma: «v12345678» → V-12345678, «j123456789» → J-12345678-9 */
export function normalizeRif(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s.\-]/g, "");
  const m = /^([VEJPG])(\d+)$/.exec(s);
  if (!m) return null;
  const [, kind, digits] = m;
  if (digits.length === 9) return `${kind}-${digits.slice(0, 8)}-${digits.slice(8)}`;
  if ((kind === "V" || kind === "E") && digits.length >= 5 && digits.length <= 8) return `${kind}-${digits}`;
  return null;
}

const CUSTOMER_SELECT = `SELECT c.id, c.code, c.legal_name AS name, c.rif, c.phones->>0 AS phone, c.email, c.address,
       (c.code = '${FINAL_CONSUMER.code}') AS "isFinalConsumer"
  FROM customers c`;

export const searchCustomers = handler({ query: z.object({ search: z.string().trim().min(1).max(80) }) }, async ({ query: q }) => {
  const rif = normalizeRif(q.search);
  const digits = q.search.replace(/\D/g, "");
  return query(
    `${CUSTOMER_SELECT}
      WHERE c.is_active AND (c.rif = $1 OR ($2 <> '' AND length($2) >= 5 AND replace(c.rif, '-', '') ILIKE '%' || $2 || '%')
                             OR c.legal_name ILIKE '%' || $3 || '%' OR c.code ILIKE $3)
      ORDER BY (c.rif = $1) DESC, c.legal_name LIMIT 20`,
    [rif, digits, q.search]
  );
});

const quickCustomerBody = z.object({
  rif: z.string().trim().min(5).max(20),
  name: z.string().trim().min(3).max(160),
  phone: z.string().trim().max(30).nullish(),
  email: z.email().max(200).nullish(),
  address: z.string().trim().max(400).nullish()
});

/** Alta rápida desde la caja: RIF o cédula y nombre. Si ya existe, 409 con el cliente */
export const quickCreateCustomer = handler({ body: quickCustomerBody }, async ({ body: b, req, res }) => {
  const rif = normalizeRif(b.rif);
  if (!rif) throw badRequest("INVALID_RIF", "Escriba una cédula (V-12345678) o un RIF (J-12345678-9)");
  const id = await withTx(txCtx(req), async (client) => {
    const existing = await one<{ id: string; name: string }>(`SELECT id, legal_name AS name FROM customers WHERE rif = $1`, [rif], client);
    if (existing) throw new HttpError(409, "CUSTOMER_EXISTS", `Ya existe el cliente ${existing.name} con ${rif}`, { id: existing.id });
    const base = rif.replace(/-/g, "");
    let code = base;
    for (let i = 2; await one(`SELECT 1 FROM customers WHERE code = $1`, [code], client); i++) code = `${base}-${i}`;
    const row = await one<{ id: string }>(
      `INSERT INTO customers (code, legal_name, rif, phones, email, address, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'Alta rápida desde el punto de venta', fn_current_app_user()) RETURNING id`,
      [code, b.name, rif, JSON.stringify(b.phone ? [b.phone] : []), b.email ?? null, b.address ?? null],
      client
    );
    return row!.id;
  });
  res.status(201);
  return one(`${CUSTOMER_SELECT} WHERE c.id = $1`, [id]);
});

// ------------------------------------------------------------------ Cálculo de la venta

const lineSchema = z.object({
  productId: z.uuid(),
  unitId: z.uuid().nullish(),
  quantity: z.number().positive().max(1e9),
  discountPct: z.number().min(0).max(100).default(0)
});

const paymentSchema = z.object({
  method: z.enum(METHODS),
  currencyId: z.uuid(),
  amount: z.number().positive().max(1e12),
  reference: z.string().trim().max(60).nullish()
});

const quoteBody = z.object({
  sessionId: z.uuid(),
  customerId: z.uuid().nullish(),
  discountPct: z.number().min(0).max(100).default(0),
  lines: z.array(lineSchema).min(1, "Agregue al menos un producto").max(200),
  payments: z.array(paymentSchema).max(20).default([]),
  changeCurrencyId: z.uuid().nullish()
});

const saleBody = quoteBody.extend({
  payments: z.array(paymentSchema).min(1, "Registre al menos un pago").max(20),
  supervisor: supervisorSchema.nullish(),
  notes: z.string().trim().max(400).nullish()
});

type QuoteInput = z.infer<typeof quoteBody>;

interface Computed {
  date: string;
  terminal: { id: string; code: string; warehouseId: string; priceListId: string | null };
  baseCurrencyId: string;
  customerId: string;
  built: BuiltOrder;
  maxDiscountPct: number;
  needsSupervisor: boolean;
  payments: (z.infer<typeof paymentSchema> & { exchangeRate: number; amountBase: number; isForeign: boolean })[];
  igtf: { rate: number; base: number; amount: number };
  grandTotal: number;
  paid: number;
  change: number;
  changeCurrencyId: string;
  changeInCurrency: number;
  pending: number;
}

/** Descuento efectivo de una línea combinado con el global */
const effectiveDiscount = (linePct: number, globalPct: number) => (1 - (1 - linePct / 100) * (1 - globalPct / 100)) * 100;

async function compute(db: Db | pg.PoolClient, b: QuoteInput, userId: string): Promise<Computed> {
  const s = await one<{ status: string; cashier_id: string; number: string; terminal_id: string; code: string; warehouse_id: string; price_list_id: string | null; default_customer_id: string | null; is_active: boolean }>(
    `SELECT s.status, s.cashier_id, s.number, t.id AS terminal_id, t.code, t.warehouse_id, t.price_list_id, t.default_customer_id, t.is_active
       FROM pos_sessions s JOIN pos_terminals t ON t.id = s.terminal_id WHERE s.id = $1`,
    [b.sessionId],
    db
  );
  if (!s) throw notFound("Turno no encontrado");
  if (s.cashier_id !== userId) throw new HttpError(403, "NOT_YOUR_SESSION", `El turno ${s.number} es de otro cajero`);
  if (s.status !== "open") throw conflict("SESSION_CLOSED", `El turno ${s.number} está cerrado: abra uno nuevo`);
  if (!s.is_active) throw conflict("TERMINAL_INACTIVE", `La caja ${s.code} está desactivada`);

  const date = await today(db);
  const params = (await one<{ base: string; max_disc: number; igtf_on: boolean; igtf_rate: number }>(
    `SELECT co.base_currency_id AS base,
            COALESCE((fn_parameter('POS', 'max_discount_pct'))::text::numeric, 0)::float AS max_disc,
            COALESCE((fn_parameter('POS', 'igtf_enabled'))::text::boolean, FALSE) AS igtf_on,
            COALESCE((fn_parameter('POS', 'igtf_rate'))::text::numeric, 0)::float AS igtf_rate
       FROM companies co WHERE co.id = fn_current_company()`,
    [],
    db
  ))!;
  const customerId = b.customerId ?? s.default_customer_id ?? (await finalConsumerId(db));

  const input: OrderInput = {
    customerId,
    orderDate: date,
    warehouseId: s.warehouse_id,
    currencyId: params.base,
    discountPct: b.discountPct,
    lines: b.lines.map((l) => ({ productId: l.productId, unitId: l.unitId ?? null, quantity: l.quantity, unitPrice: null, discountPct: l.discountPct, notes: null }))
  };
  const built = await buildOrder(db, input, { priceListId: s.price_list_id, applyWithholdings: false });
  const needsSupervisor = b.lines.some((l) => effectiveDiscount(l.discountPct, b.discountPct) > params.max_disc + 1e-6);

  const payments: Computed["payments"] = [];
  for (const p of b.payments) {
    const rate = await exchangeRate(db, p.currencyId, date);
    payments.push({ ...p, exchangeRate: rate, amountBase: round2(p.amount * rate), isForeign: p.currencyId !== params.base });
  }
  const total = built.totals.total;
  const foreignBase = round2(payments.filter((p) => p.isForeign).reduce((a, p) => a + p.amountBase, 0));
  const igtfBase = params.igtf_on ? round2(Math.min(foreignBase, total)) : 0;
  const igtfAmount = round2((igtfBase * params.igtf_rate) / 100);
  const grandTotal = round2(total + igtfAmount);
  const paid = round2(payments.reduce((a, p) => a + p.amountBase, 0));
  const change = Math.max(0, round2(paid - grandTotal));
  const changeCurrencyId = b.changeCurrencyId ?? params.base;
  const changeRate = change > 0 ? await exchangeRate(db, changeCurrencyId, date) : 1;

  return {
    date,
    terminal: { id: s.terminal_id, code: s.code, warehouseId: s.warehouse_id, priceListId: s.price_list_id },
    baseCurrencyId: params.base,
    customerId,
    built,
    maxDiscountPct: params.max_disc,
    needsSupervisor,
    payments,
    igtf: { rate: params.igtf_on ? params.igtf_rate : 0, base: igtfBase, amount: igtfAmount },
    grandTotal,
    paid,
    change,
    changeCurrencyId,
    changeInCurrency: round2(change / changeRate),
    pending: Math.max(0, round2(grandTotal - paid))
  };
}

/** Lo que el front necesita para mostrar la cuenta */
async function presentQuote(c: Computed, db: Db) {
  const ids = c.built.lines.map((l) => l.productId);
  const units = c.built.lines.map((l) => l.unitId);
  const info = new Map(
    (
      await query<{ id: string; code: string; name: string }>(`SELECT id, code, name FROM products WHERE id = ANY($1)`, [ids], db)
    ).map((p) => [p.id, p])
  );
  const unitCodes = new Map(
    (await query<{ id: string; code: string }>(`SELECT id, code FROM catalogs_units WHERE id = ANY($1)`, [units], db)).map((u) => [u.id, u.code])
  );
  const customer = await one(`${CUSTOMER_SELECT} WHERE c.id = $1`, [c.customerId], db);
  const t = c.built.totals;
  return {
    customer,
    terminalCode: c.terminal.code,
    lines: c.built.lines.map((l, i) => ({
      lineNo: i + 1,
      productId: l.productId,
      productCode: info.get(l.productId)?.code,
      productName: info.get(l.productId)?.name,
      unitId: l.unitId,
      unitCode: unitCodes.get(l.unitId),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      priceSource: l.priceSource,
      discountPct: l.discountPct,
      taxRate: l.taxRate,
      netAmount: l.net,
      taxAmount: l.tax
    })),
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxableAmount: t.taxableAmount,
    taxes: t.taxes,
    taxAmount: t.taxAmount,
    total: t.total,
    igtf: c.igtf,
    grandTotal: c.grandTotal,
    payments: c.payments.map((p) => ({ method: p.method, currencyId: p.currencyId, amount: p.amount, exchangeRate: p.exchangeRate, amountBase: p.amountBase })),
    paid: c.paid,
    pending: c.pending,
    change: c.change,
    changeCurrencyId: c.changeCurrencyId,
    changeInCurrency: c.changeInCurrency,
    maxDiscountPct: c.maxDiscountPct,
    needsSupervisor: c.needsSupervisor
  };
}

/** Cotiza sin guardar: totales, IVA por alícuota, IGTF, lo pendiente y el vuelto */
export const quoteSale = handler({ body: quoteBody }, async ({ body, req }) => presentQuote(await compute(pool, body, authOf(req).userId), pool));

/** Valida que los pagos cubran la venta y que solo el efectivo dé vuelto */
function assertPayments(c: Computed) {
  if (c.pending > CENT) throw badRequest("INSUFFICIENT_PAYMENT", `Faltan ${c.pending.toFixed(2)} por cobrar`);
  const nonCash = round2(c.payments.filter((p) => p.method !== "cash").reduce((a, p) => a + p.amountBase, 0));
  if (nonCash > c.grandTotal + CENT) throw badRequest("OVERPAID_NON_CASH", "Los pagos electrónicos superan el total: solo el efectivo da vuelto");
  for (const p of c.payments) {
    if (p.method !== "cash" && !p.reference) throw badRequest("REFERENCE_REQUIRED", "Indique la referencia de los pagos con punto, pago móvil o transferencia");
  }
}

// ------------------------------------------------------------------ Vender

interface Pick {
  saleLine: number;
  productId: string;
  lotId: string | null;
  stockQty: number;
}

/** Lotes por FEFO sobre lo libre del almacén; `used` lleva lo ya tomado por otras líneas */
async function pickFefo(client: pg.PoolClient, warehouseId: string, productId: string, need: number, date: string, used: Map<string, number>) {
  const caps = await query<{ lot_id: string | null; free: string }>(
    `SELECT b.lot_id, b.quantity - b.reserved AS free
       FROM stock_balances b LEFT JOIN lots l ON l.id = b.lot_id
      WHERE b.warehouse_id = $1 AND b.product_id = $2 AND b.quantity - b.reserved > 0
        AND (b.lot_id IS NULL OR (l.quality_status = 'approved' AND (l.expires_on IS NULL OR l.expires_on >= $3::date)))
      ORDER BY l.expires_on NULLS LAST, l.lot_code NULLS FIRST`,
    [warehouseId, productId, date],
    client
  );
  const picks: { lotId: string | null; stockQty: number }[] = [];
  let left = need;
  for (const c of caps) {
    if (left <= EPS) break;
    const key = `${productId}:${c.lot_id ?? ""}`;
    const free = round6(Number(c.free) - (used.get(key) ?? 0));
    const take = round6(Math.min(free, left));
    if (take <= EPS) continue;
    picks.push({ lotId: c.lot_id, stockQty: take });
    used.set(key, round6((used.get(key) ?? 0) + take));
    left = round6(left - take);
  }
  return { picks, missing: left > EPS ? left : 0 };
}

export const createSale = handler({ body: saleBody }, async ({ body: b, req, res }) => {
  const me = authOf(req).userId;
  // La clave del supervisor se verifica antes y fuera de la transacción (el conteo de fallos persiste)
  const preview = await compute(pool, b, me);
  assertPayments(preview);
  const authorizedBy = preview.needsSupervisor
    ? await authorizeSupervisor(req, b.supervisor, `Un descuento mayor a ${preview.maxDiscountPct}%`)
    : null;

  const saleId = await withTx(txCtx(req), async (client) => {
    await lockOwnSession(client, b.sessionId, me);
    const c = await compute(client, b, me);
    assertPayments(c);
    if (c.needsSupervisor && !authorizedBy) throw new HttpError(403, "SUPERVISOR_REQUIRED", "El descuento requiere la autorización de un supervisor");

    // 1) Existencia: FEFO por línea (cantidades en unidad de almacén)
    const stockable = new Map(
      (
        await query<{ id: string; code: string; is_stockable: boolean }>(
          `SELECT id, code, is_stockable FROM products WHERE id = ANY($1)`,
          [c.built.lines.map((l) => l.productId)],
          client
        )
      ).map((p) => [p.id, p])
    );
    const used = new Map<string, number>();
    const picks: Pick[] = [];
    for (const [i, l] of c.built.lines.entries()) {
      const p = stockable.get(l.productId)!;
      if (!p.is_stockable) continue;
      const need = round6(l.quantity * l.unitFactor);
      const r = await pickFefo(client, c.terminal.warehouseId, l.productId, need, c.date, used);
      if (r.missing > 0) {
        throw conflict("INSUFFICIENT_STOCK", `Línea ${i + 1} (${p.code}): faltan ${round6(r.missing / l.unitFactor)} en el almacén de la caja`);
      }
      for (const x of r.picks) picks.push({ saleLine: i + 1, productId: l.productId, ...x });
    }

    // 2) Comprobante con el correlativo de la caja
    const tk = (await one<{ n: string; prefix: string; padding: number }>(
      `UPDATE pos_terminals SET next_ticket = next_ticket + 1 WHERE id = $1 RETURNING next_ticket - 1 AS n, ticket_prefix AS prefix, ticket_padding AS padding`,
      [c.terminal.id],
      client
    ))!;
    const ticket = `${tk.prefix}${String(tk.n).padStart(tk.padding, "0")}`;
    const t = c.built.totals;
    const sale = await one<{ id: string }>(
      `INSERT INTO pos_sales (ticket_number, sale_date, terminal_id, session_id, warehouse_id, price_list_id, customer_id, currency_id, discount_pct,
                              subtotal, discount_amount, taxable_amount, tax_amount, total, igtf_rate, igtf_base, igtf_amount, grand_total,
                              paid_amount, change_amount, change_currency_id, change_in_currency, taxes_detail, discount_authorized_by, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, fn_current_app_user())
       RETURNING id`,
      [
        ticket,
        c.date,
        c.terminal.id,
        b.sessionId,
        c.terminal.warehouseId,
        c.terminal.priceListId,
        c.customerId,
        c.baseCurrencyId,
        b.discountPct,
        t.subtotal,
        t.discountAmount,
        t.taxableAmount,
        t.taxAmount,
        t.total,
        c.igtf.rate,
        c.igtf.base,
        c.igtf.amount,
        c.grandTotal,
        c.paid,
        c.change,
        c.change > 0 ? c.changeCurrencyId : null,
        c.change > 0 ? c.changeInCurrency : null,
        JSON.stringify({ taxes: t.taxes }),
        c.needsSupervisor ? authorizedBy : null,
        b.notes ?? null
      ],
      client
    );
    const id = sale!.id;

    for (const [i, l] of c.built.lines.entries()) {
      await client.query(
        `INSERT INTO pos_sales_details (sale_id, line_no, product_id, unit_id, unit_factor, quantity, stock_quantity, unit_price, price_source,
                                        discount_pct, treatment_id, tax_rate, net_amount, tax_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, i + 1, l.productId, l.unitId, l.unitFactor, l.quantity, round6(l.quantity * l.unitFactor), l.unitPrice, l.priceSource, l.discountPct, l.treatmentId, l.taxRate, l.net, l.tax]
      );
    }
    for (const [i, p] of c.payments.entries()) {
      await client.query(
        `INSERT INTO pos_sales_payments (sale_id, line_no, method, currency_id, amount, exchange_rate, amount_base, reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, i + 1, p.method, p.currencyId, round2(p.amount), p.exchangeRate, p.amountBase, p.reference ?? null]
      );
    }

    // 3) Salida de inventario VENTA_POS y costo de lo vendido
    if (picks.length) {
      const concept = await one<{ id: string }>(`SELECT id FROM catalogs_movement_concepts WHERE code = 'VENTA_POS' AND is_active`, [], client);
      if (!concept) throw conflict("CONCEPT_MISSING", "El concepto de inventario VENTA_POS no existe o está inactivo");
      const mv = await one<{ id: string }>(
        `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, reference, notes, source_module, source_document_id, created_by)
         VALUES (fn_next_document_number('MOV'), $1, $2, 'out', $3, $4, $5, 'POS', $6, fn_current_app_user()) RETURNING id`,
        [c.date, concept.id, c.terminal.warehouseId, ticket, `Venta de mostrador ${ticket} (caja ${c.terminal.code})`, id],
        client
      );
      for (const [i, p] of picks.entries()) {
        await client.query(`INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity) VALUES ($1, $2, $3, $4, $5)`, [
          mv!.id,
          i + 1,
          p.productId,
          p.lotId,
          p.stockQty
        ]);
      }
      await client.query(`SELECT fn_post_inventory_movement($1)`, [mv!.id]);
      const posted = await query<{ line_no: number; total_cost: string }>(
        `SELECT line_no, total_cost FROM inventory_movements_details WHERE movement_id = $1`,
        [mv!.id],
        client
      );
      const costByLine = new Map<number, number>();
      for (const d of posted) {
        const line = picks[d.line_no - 1].saleLine;
        costByLine.set(line, (costByLine.get(line) ?? 0) + Number(d.total_cost));
      }
      for (const [line, cost] of costByLine) {
        await client.query(`UPDATE pos_sales_details SET unit_cost = $3 / stock_quantity WHERE sale_id = $1 AND line_no = $2`, [id, line, cost]);
      }
      await client.query(`UPDATE pos_sales SET movement_id = $2, cost_amount = $3 WHERE id = $1`, [
        id,
        mv!.id,
        [...costByLine.values()].reduce((a, x) => a + x, 0)
      ]);
    }
    return id;
  });
  res.status(201);
  return saleDetail(saleId, null);
});

// ------------------------------------------------------------------ Anular

export const voidSale = handler(
  {
    params: idParams,
    body: z.object({ reason: z.string().trim().min(3, "Indique el motivo").max(400), supervisor: supervisorSchema.nullish() })
  },
  async ({ params, body, req }) => {
    const scope = ownerScope(req);
    const current = await one<{ created_by: string | null }>(`SELECT created_by FROM pos_sales WHERE id = $1`, [params.id]);
    if (!current || (scope && current.created_by !== scope)) throw notFound("Venta no encontrada");
    const authorizedBy = await authorizeSupervisor(req, body.supervisor, "Anular una venta");
    await withTx(txCtx(req), async (client) => {
      const v = await one<{ status: string; ticket_number: string; movement_id: string | null; session_status: string }>(
        `SELECT v.status, v.ticket_number, v.movement_id, s.status AS session_status
           FROM pos_sales v JOIN pos_sessions s ON s.id = v.session_id WHERE v.id = $1 FOR UPDATE OF v, s`,
        [params.id],
        client
      );
      if (!v) throw notFound("Venta no encontrada");
      if (v.status !== "completed") throw conflict("ALREADY_VOIDED", `La venta ${v.ticket_number} ya está anulada`);
      if (v.session_status !== "open") {
        throw conflict("SESSION_CLOSED", `El turno de la venta ${v.ticket_number} ya cerró: registre una devolución en lugar de anularla`);
      }
      if (v.movement_id) await client.query(`SELECT fn_reverse_inventory_movement($1)`, [v.movement_id]);
      await client.query(
        `UPDATE pos_sales SET status = 'voided', voided_at = NOW(), voided_by = fn_current_app_user(), void_authorized_by = $2, void_reason = $3 WHERE id = $1`,
        [params.id, authorizedBy, body.reason]
      );
    });
    return saleDetail(params.id, null);
  }
);

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT v.id, v.ticket_number AS "ticketNumber", v.status, to_char(v.sale_date, 'YYYY-MM-DD') AS "saleDate", v.created_at AS "soldAt",
       v.terminal_id AS "terminalId", t.code AS "terminalCode", t.name AS "terminalName", v.session_id AS "sessionId", s.number AS "sessionNumber",
       w.code AS "warehouseCode", pl.name AS "priceListName",
       v.customer_id AS "customerId", c.legal_name AS "customerName", c.rif AS "customerRif", c.address AS "customerAddress",
       cur.code AS "currencyCode", v.discount_pct::float AS "discountPct", v.subtotal::float AS subtotal, v.discount_amount::float AS "discountAmount",
       v.taxable_amount::float AS "taxableAmount", v.tax_amount::float AS "taxAmount", v.total::float AS total,
       v.igtf_rate::float AS "igtfRate", v.igtf_base::float AS "igtfBase", v.igtf_amount::float AS "igtfAmount", v.grand_total::float AS "grandTotal",
       v.paid_amount::float AS "paidAmount", v.change_amount::float AS "changeAmount", chc.code AS "changeCurrencyCode",
       v.change_in_currency::float AS "changeInCurrency", v.cost_amount::float AS "costAmount", v.taxes_detail AS "taxesDetail",
       m.number AS "movementNumber", v.notes, v.created_by AS "createdBy", cb.names AS "cashierName", da.names AS "discountAuthorizedBy",
       v.voided_at AS "voidedAt", vb.names AS "voidedByName", va.names AS "voidAuthorizedBy", v.void_reason AS "voidReason"
  FROM pos_sales v
  JOIN pos_terminals t ON t.id = v.terminal_id
  JOIN pos_sessions s ON s.id = v.session_id
  JOIN warehouses w ON w.id = v.warehouse_id
  JOIN customers c ON c.id = v.customer_id
  JOIN catalogs_currencies cur ON cur.id = v.currency_id
  LEFT JOIN catalogs_currencies chc ON chc.id = v.change_currency_id
  LEFT JOIN price_lists pl ON pl.id = v.price_list_id
  LEFT JOIN inventory_movements m ON m.id = v.movement_id
  LEFT JOIN users cb ON cb.id = v.created_by
  LEFT JOIN users da ON da.id = v.discount_authorized_by
  LEFT JOIN users vb ON vb.id = v.voided_by
  LEFT JOIN users va ON va.id = v.void_authorized_by`;

export async function saleDetail(id: string, scope: string | null, db?: Db) {
  const header = await one<{ createdBy: string | null }>(`${HEADER} WHERE v.id = $1`, [id], db);
  if (!header || (scope && header.createdBy !== scope)) throw notFound("Venta no encontrada");
  const [lines, payments] = await Promise.all([
    query(
      `SELECT d.line_no AS "lineNo", d.product_id AS "productId", p.code AS "productCode", p.name AS "productName", p.barcode,
              u.code AS "unitCode", d.unit_factor::float AS "unitFactor", d.quantity::float AS quantity, d.unit_price::float AS "unitPrice",
              d.price_source AS "priceSource", d.discount_pct::float AS "discountPct", d.tax_rate::float AS "taxRate",
              d.net_amount::float AS "netAmount", d.tax_amount::float AS "taxAmount", d.unit_cost::float AS "unitCost"
         FROM pos_sales_details d JOIN products p ON p.id = d.product_id JOIN catalogs_units u ON u.id = d.unit_id
        WHERE d.sale_id = $1 ORDER BY d.line_no`,
      [id],
      db
    ),
    query(
      `SELECT p.line_no AS "lineNo", p.method, p.currency_id AS "currencyId", c.code AS "currencyCode", p.amount::float AS amount,
              p.exchange_rate::float AS "exchangeRate", p.amount_base::float AS "amountBase", p.reference
         FROM pos_sales_payments p JOIN catalogs_currencies c ON c.id = p.currency_id
        WHERE p.sale_id = $1 ORDER BY p.line_no`,
      [id],
      db
    )
  ]);
  return { ...header, lines, payments };
}

const listQuery = pageQuery.extend({
  search: z.string().trim().max(80).optional(),
  sessionId: z.uuid().optional(),
  terminalId: z.uuid().optional(),
  status: z.enum(["completed", "voided"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listSales = handler({ query: listQuery }, async ({ query: q, req }) => {
  const rows = await query(
    `SELECT COUNT(*) OVER()::int AS total_rows, v.id, v.ticket_number AS "ticketNumber", v.status, to_char(v.sale_date, 'YYYY-MM-DD') AS "saleDate",
            v.created_at AS "soldAt", t.code AS "terminalCode", s.number AS "sessionNumber", c.legal_name AS "customerName", c.rif AS "customerRif",
            v.grand_total::float AS "grandTotal", cb.names AS "cashierName",
            (SELECT string_agg(DISTINCT p.method, ',') FROM pos_sales_payments p WHERE p.sale_id = v.id) AS methods
       FROM pos_sales v
       JOIN pos_terminals t ON t.id = v.terminal_id
       JOIN pos_sessions s ON s.id = v.session_id
       JOIN customers c ON c.id = v.customer_id
       LEFT JOIN users cb ON cb.id = v.created_by
      WHERE ($1::text IS NULL OR v.ticket_number ILIKE '%' || $1 || '%' OR c.legal_name ILIKE '%' || $1 || '%' OR c.rif ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR v.session_id = $2)
        AND ($3::uuid IS NULL OR v.terminal_id = $3)
        AND ($4::text IS NULL OR v.status = $4)
        AND ($5::date IS NULL OR v.sale_date >= $5)
        AND ($6::date IS NULL OR v.sale_date <= $6)
        AND ($7::uuid IS NULL OR v.created_by = $7)
      ORDER BY v.created_at DESC
      LIMIT $8 OFFSET $9`,
    [q.search || null, q.sessionId ?? null, q.terminalId ?? null, q.status ?? null, q.from ?? null, q.to ?? null, ownerScope(req), q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export const getSale = handler({ params: idParams }, async ({ params, req }) => saleDetail(params.id, ownerScope(req)));

export { ownerScope as saleOwnerScope };
