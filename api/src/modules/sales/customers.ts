/**
 * @project FabriHub - API
 * @file src/modules/sales/customers.ts
 * @description Clientes y sus contactos (SAL_CUSTOMERS) — tesis: Clases Clientes y Contacto Clientes
 *
 * Mismo molde que Proveedores, más lo propio de la venta: vendedor, dirección de despacho,
 * límite de crédito (lo usa la confirmación de la orden) y si el cliente es agente de retención.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();
const optId = z.uuid().nullish();

const fields = {
  legalName: z.string().trim().min(3).max(160),
  tradeName: optText(120),
  rif: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[VEJPG]-\d{8}-\d$/, "Formato de RIF: J-12345678-9"),
  phones: z.array(z.string().trim().regex(/^[0-9+()\s-]{7,20}$/, "Teléfono inválido")).max(3).default([]),
  email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
  address: optText(400),
  deliveryAddress: optText(400),
  city: optText(80),
  state: optText(80),
  country: z.string().trim().min(2).max(80).default("Venezuela"),
  notes: optText(800),
  paymentTermId: optId,
  deliveryTermId: optId,
  deliveryMethodId: optId,
  zoneId: optId,
  businessTypeId: optId,
  sellerId: optId,
  priceListId: optId,
  fiscalTreatmentId: optId,
  currencyId: optId,
  isWithholdingAgent: z.boolean().optional(),
  creditLimit: z.number().min(0).max(1e14).nullish(),
  receivableAccount: optText(30),
  incomeAccount: optText(30)
};

const COLUMNS: Record<string, string> = {
  legalName: "legal_name",
  tradeName: "trade_name",
  rif: "rif",
  phones: "phones",
  email: "email",
  address: "address",
  deliveryAddress: "delivery_address",
  city: "city",
  state: "state",
  country: "country",
  notes: "notes",
  paymentTermId: "payment_term_id",
  deliveryTermId: "delivery_term_id",
  deliveryMethodId: "delivery_method_id",
  zoneId: "zone_id",
  businessTypeId: "business_type_id",
  sellerId: "seller_id",
  priceListId: "price_list_id",
  fiscalTreatmentId: "fiscal_treatment_id",
  currencyId: "currency_id",
  isWithholdingAgent: "is_withholding_agent",
  creditLimit: "credit_limit",
  receivableAccount: "receivable_account",
  incomeAccount: "income_account",
  isActive: "is_active"
};

const SELECT = `SELECT s.id, s.code, s.legal_name AS "legalName", s.trade_name AS "tradeName", s.rif, s.phones, s.email,
  s.address, s.delivery_address AS "deliveryAddress", s.city, s.state, s.country, s.notes, s.is_active AS "isActive",
  s.payment_term_id AS "paymentTermId", pt.name AS "paymentTermName", s.delivery_term_id AS "deliveryTermId",
  s.delivery_method_id AS "deliveryMethodId", s.zone_id AS "zoneId", z.name AS "zoneName",
  s.business_type_id AS "businessTypeId", bt.name AS "businessTypeName", s.seller_id AS "sellerId", b.name AS "sellerName",
  s.price_list_id AS "priceListId", pl.code AS "priceListCode", s.fiscal_treatment_id AS "fiscalTreatmentId", ft.code AS "fiscalTreatmentCode",
  s.currency_id AS "currencyId", cur.code AS "currencyCode", s.is_withholding_agent AS "isWithholdingAgent", s.credit_limit::float AS "creditLimit",
  s.receivable_account AS "receivableAccount", s.income_account AS "incomeAccount",
  (SELECT COALESCE(SUM(so.total * so.exchange_rate), 0) FROM sales_orders so
    WHERE so.customer_id = s.id AND so.status IN ('pending_approval', 'confirmed', 'partially_delivered'))::float AS "creditUsed",
  s.updated_at AS "updatedAt",
  (SELECT COUNT(*) FROM sales_orders so WHERE so.customer_id = s.id AND so.status IN ('pending_approval', 'confirmed', 'partially_delivered'))::int AS "openOrders"
  FROM customers s
  LEFT JOIN catalogs_payment_terms pt ON pt.id = s.payment_term_id
  LEFT JOIN catalogs_zones z ON z.id = s.zone_id
  LEFT JOIN catalogs_business_types bt ON bt.id = s.business_type_id
  LEFT JOIN sellers b ON b.id = s.seller_id
  LEFT JOIN price_lists pl ON pl.id = s.price_list_id
  LEFT JOIN fiscal_treatments ft ON ft.id = s.fiscal_treatment_id
  LEFT JOIN catalogs_currencies cur ON cur.id = s.currency_id`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(80).optional(),
  active: z.enum(["true", "false"]).optional(),
  businessTypeId: z.uuid().optional()
});

export const listCustomers = handler({ query: listQuery }, async ({ query: q }) => {
  const rows = await query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM (${SELECT}) x
      WHERE ($1::text IS NULL OR x.code ILIKE '%' || $1 || '%' OR x."legalName" ILIKE '%' || $1 || '%'
             OR x."tradeName" ILIKE '%' || $1 || '%' OR x.rif ILIKE '%' || $1 || '%')
        AND ($2::boolean IS NULL OR x."isActive" = $2)
        AND ($3::uuid IS NULL OR x."businessTypeId" = $3)
      ORDER BY x."legalName" LIMIT $4 OFFSET $5`,
    [q.search || null, q.active === undefined ? null : q.active === "true", q.businessTypeId ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function customerDetail(id: string) {
  const customer = await one(`${SELECT} WHERE s.id = $1`, [id]);
  if (!customer) throw notFound("Cliente no encontrado");
  const contacts = await query(
    `SELECT id, name, position, phone, email, is_primary AS "isPrimary" FROM customers_contacts
      WHERE customer_id = $1 ORDER BY is_primary DESC, name`,
    [id]
  );
  return { ...customer, contacts };
}

export const getCustomer = handler({ params: idParams }, ({ params }) => customerDetail(params.id));

async function assertRifFree(rif: string, exceptId?: string) {
  const other = await one<{ code: string }>(`SELECT code FROM customers WHERE rif = $1 AND ($2::uuid IS NULL OR id <> $2)`, [rif, exceptId ?? null]);
  if (other) throw conflict("RIF_TAKEN", `El RIF ${rif} ya está registrado (cliente ${other.code})`);
}

export const createCustomer = handler(
  {
    body: z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _"),
      ...fields
    })
  },
  async ({ body: b, req, res }) => {
    await assertRifFree(b.rif);
    const data = b as unknown as Record<string, unknown>;
    const keys = Object.keys(COLUMNS).filter((k) => data[k] !== undefined);
    const cols = ["code", ...keys.map((k) => COLUMNS[k])];
    const values = [b.code, ...keys.map((k) => (k === "phones" ? JSON.stringify(data[k]) : data[k] ?? null))];
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO customers (${cols.join(", ")}, created_by, updated_by)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        values,
        client
      )
    );
    res.status(201);
    return customerDetail(row!.id);
  }
);

export const updateCustomer = handler(
  {
    params: idParams,
    body: z.object({ ...fields, isActive: z.boolean() }).partial().refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body: b, req }) => {
    if (b.rif) await assertRifFree(b.rif, params.id);
    const data = b as unknown as Record<string, unknown>;
    const keys = Object.keys(data).filter((k) => COLUMNS[k] && data[k] !== undefined);
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE customers SET ${[...keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`), "updated_by = fn_current_app_user()"].join(", ")}
          WHERE id = $1 RETURNING id`,
        [params.id, ...keys.map((k) => (k === "phones" ? JSON.stringify(data[k]) : data[k]))],
        client
      )
    );
    if (!row) throw notFound("Cliente no encontrado");
    return customerDetail(params.id);
  }
);

/** Baja física solo sin órdenes (si no, la FK responde 409 y se desactiva en su lugar) */
export const deleteCustomer = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM customers WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Cliente no encontrado");
  return undefined;
});

// ------------------------------------------------------------------ Contactos

const contactBody = z.object({
  name: z.string().trim().min(2).max(120),
  position: optText(80),
  phone: optText(30),
  email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
  isPrimary: z.boolean().default(false)
});

export const addCustomerContact = handler({ params: idParams, body: contactBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    if (!(await one(`SELECT 1 FROM customers WHERE id = $1`, [params.id], client))) throw notFound("Cliente no encontrado");
    if (b.isPrimary) await client.query(`UPDATE customers_contacts SET is_primary = FALSE WHERE customer_id = $1`, [params.id]);
    await client.query(
      `INSERT INTO customers_contacts (customer_id, name, position, phone, email, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user())`,
      [params.id, b.name, b.position ?? null, b.phone ?? null, b.email ?? null, b.isPrimary]
    );
  });
  return customerDetail(params.id);
});

export const updateCustomerContact = handler(
  { params: z.object({ contactId: z.uuid() }), body: contactBody },
  async ({ params, body: b, req }) => {
    const customerId = await withTx(txCtx(req), async (client) => {
      const c = await one<{ customer_id: string }>(`SELECT customer_id FROM customers_contacts WHERE id = $1`, [params.contactId], client);
      if (!c) throw notFound("Contacto no encontrado");
      if (b.isPrimary) await client.query(`UPDATE customers_contacts SET is_primary = FALSE WHERE customer_id = $1`, [c.customer_id]);
      await client.query(
        `UPDATE customers_contacts SET name = $2, position = $3, phone = $4, email = $5, is_primary = $6 WHERE id = $1`,
        [params.contactId, b.name, b.position ?? null, b.phone ?? null, b.email ?? null, b.isPrimary]
      );
      return c.customer_id;
    });
    return customerDetail(customerId);
  }
);

export const deleteCustomerContact = handler({ params: z.object({ contactId: z.uuid() }) }, async ({ params, req }) => {
  await withTx(txCtx(req), (client) => client.query(`DELETE FROM customers_contacts WHERE id = $1`, [params.contactId]));
  return undefined;
});
