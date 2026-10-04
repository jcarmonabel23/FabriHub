/**
 * @project FabriHub - API
 * @file src/modules/purchases/suppliers.ts
 * @description Proveedores y sus contactos (PUR_SUPPLIERS) — tesis: Clases Proveedores y Contacto Proveedores
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
  city: optText(80),
  state: optText(80),
  country: z.string().trim().min(2).max(80).default("Venezuela"),
  notes: optText(800),
  paymentTermId: optId,
  deliveryTermId: optId,
  deliveryMethodId: optId,
  zoneId: optId,
  businessTypeId: optId,
  buyerId: optId,
  priceListId: optId,
  fiscalTreatmentId: optId,
  currencyId: optId,
  payableAccount: optText(30),
  expenseAccount: optText(30)
};

const COLUMNS: Record<string, string> = {
  legalName: "legal_name",
  tradeName: "trade_name",
  rif: "rif",
  phones: "phones",
  email: "email",
  address: "address",
  city: "city",
  state: "state",
  country: "country",
  notes: "notes",
  paymentTermId: "payment_term_id",
  deliveryTermId: "delivery_term_id",
  deliveryMethodId: "delivery_method_id",
  zoneId: "zone_id",
  businessTypeId: "business_type_id",
  buyerId: "buyer_id",
  priceListId: "price_list_id",
  fiscalTreatmentId: "fiscal_treatment_id",
  currencyId: "currency_id",
  payableAccount: "payable_account",
  expenseAccount: "expense_account",
  isActive: "is_active"
};

const SELECT = `SELECT s.id, s.code, s.legal_name AS "legalName", s.trade_name AS "tradeName", s.rif, s.phones, s.email,
  s.address, s.city, s.state, s.country, s.notes, s.is_active AS "isActive",
  s.payment_term_id AS "paymentTermId", pt.name AS "paymentTermName", s.delivery_term_id AS "deliveryTermId",
  s.delivery_method_id AS "deliveryMethodId", s.zone_id AS "zoneId", z.name AS "zoneName",
  s.business_type_id AS "businessTypeId", bt.name AS "businessTypeName", s.buyer_id AS "buyerId", b.name AS "buyerName",
  s.price_list_id AS "priceListId", pl.code AS "priceListCode", s.fiscal_treatment_id AS "fiscalTreatmentId", ft.code AS "fiscalTreatmentCode",
  s.currency_id AS "currencyId", cur.code AS "currencyCode", s.payable_account AS "payableAccount", s.expense_account AS "expenseAccount",
  s.updated_at AS "updatedAt",
  (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status IN ('pending_approval', 'approved', 'partially_received'))::int AS "openOrders"
  FROM suppliers s
  LEFT JOIN catalogs_payment_terms pt ON pt.id = s.payment_term_id
  LEFT JOIN catalogs_zones z ON z.id = s.zone_id
  LEFT JOIN catalogs_business_types bt ON bt.id = s.business_type_id
  LEFT JOIN buyers b ON b.id = s.buyer_id
  LEFT JOIN price_lists pl ON pl.id = s.price_list_id
  LEFT JOIN fiscal_treatments ft ON ft.id = s.fiscal_treatment_id
  LEFT JOIN catalogs_currencies cur ON cur.id = s.currency_id`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(80).optional(),
  active: z.enum(["true", "false"]).optional(),
  businessTypeId: z.uuid().optional()
});

export const listSuppliers = handler({ query: listQuery }, async ({ query: q }) => {
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

async function supplierDetail(id: string) {
  const supplier = await one(`${SELECT} WHERE s.id = $1`, [id]);
  if (!supplier) throw notFound("Proveedor no encontrado");
  const contacts = await query(
    `SELECT id, name, position, phone, email, is_primary AS "isPrimary" FROM suppliers_contacts
      WHERE supplier_id = $1 ORDER BY is_primary DESC, name`,
    [id]
  );
  return { ...supplier, contacts };
}

export const getSupplier = handler({ params: idParams }, ({ params }) => supplierDetail(params.id));

async function assertRifFree(rif: string, exceptId?: string) {
  const other = await one<{ code: string }>(`SELECT code FROM suppliers WHERE rif = $1 AND ($2::uuid IS NULL OR id <> $2)`, [rif, exceptId ?? null]);
  if (other) throw conflict("RIF_TAKEN", `El RIF ${rif} ya está registrado (proveedor ${other.code})`);
}

export const createSupplier = handler(
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
        `INSERT INTO suppliers (${cols.join(", ")}, created_by, updated_by)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        values,
        client
      )
    );
    res.status(201);
    return supplierDetail(row!.id);
  }
);

export const updateSupplier = handler(
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
        `UPDATE suppliers SET ${[...keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`), "updated_by = fn_current_app_user()"].join(", ")}
          WHERE id = $1 RETURNING id`,
        [params.id, ...keys.map((k) => (k === "phones" ? JSON.stringify(data[k]) : data[k]))],
        client
      )
    );
    if (!row) throw notFound("Proveedor no encontrado");
    return supplierDetail(params.id);
  }
);

/** Baja física solo sin órdenes ni lotes (si no, la FK responde 409 y se desactiva en su lugar) */
export const deleteSupplier = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM suppliers WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Proveedor no encontrado");
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

export const addContact = handler({ params: idParams, body: contactBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    if (!(await one(`SELECT 1 FROM suppliers WHERE id = $1`, [params.id], client))) throw notFound("Proveedor no encontrado");
    if (b.isPrimary) await client.query(`UPDATE suppliers_contacts SET is_primary = FALSE WHERE supplier_id = $1`, [params.id]);
    await client.query(
      `INSERT INTO suppliers_contacts (supplier_id, name, position, phone, email, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user())`,
      [params.id, b.name, b.position ?? null, b.phone ?? null, b.email ?? null, b.isPrimary]
    );
  });
  return supplierDetail(params.id);
});

export const updateContact = handler(
  { params: z.object({ contactId: z.uuid() }), body: contactBody },
  async ({ params, body: b, req }) => {
    const supplierId = await withTx(txCtx(req), async (client) => {
      const c = await one<{ supplier_id: string }>(`SELECT supplier_id FROM suppliers_contacts WHERE id = $1`, [params.contactId], client);
      if (!c) throw notFound("Contacto no encontrado");
      if (b.isPrimary) await client.query(`UPDATE suppliers_contacts SET is_primary = FALSE WHERE supplier_id = $1`, [c.supplier_id]);
      await client.query(
        `UPDATE suppliers_contacts SET name = $2, position = $3, phone = $4, email = $5, is_primary = $6 WHERE id = $1`,
        [params.contactId, b.name, b.position ?? null, b.phone ?? null, b.email ?? null, b.isPrimary]
      );
      return c.supplier_id;
    });
    return supplierDetail(supplierId);
  }
);

export const deleteContact = handler({ params: z.object({ contactId: z.uuid() }) }, async ({ params, req }) => {
  await withTx(txCtx(req), (client) => client.query(`DELETE FROM suppliers_contacts WHERE id = $1`, [params.contactId]));
  return undefined;
});
