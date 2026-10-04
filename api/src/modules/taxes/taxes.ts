/**
 * @project FabriHub - API
 * @file src/modules/taxes/taxes.ts
 * @description Impuestos y sus tarifas (TAX_TAXES) — agregación impuesto 1..N tarifas
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)");
const kind = z.enum(["vat", "luxury", "other"]);
const rateValue = z.number().min(0).max(100);
const account = z
  .string()
  .trim()
  .max(30)
  .transform((v) => v || null)
  .nullish();

const LIST = `SELECT t.id, t.code, t.name, t.description, t.kind, t.is_active AS "isActive", t.order_list AS "orderList",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'code', r.code, 'name', r.name, 'rate', r.rate::float, 'account', r.account,
      'isActive', r.is_active,
      'treatments', (SELECT COUNT(*) FROM fiscal_treatments f WHERE f.tax_rate_id = r.id)
    ) ORDER BY r.order_list, r.code)
    FROM taxes_rates r WHERE r.tax_id = t.id), '[]') AS rates
  FROM taxes t`;

export const listTaxes = handler({}, () => query(`${LIST} ORDER BY t.order_list, t.code`));

const getTax = (id: string) => one(`${LIST} WHERE t.id = $1`, [id]);

export const createTax = handler(
  {
    body: z.object({
      code,
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(400).nullish(),
      kind
    })
  },
  async ({ body, req, res }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO taxes (code, name, description, kind, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM taxes),
                 fn_current_app_user(), fn_current_app_user())
         RETURNING id`,
        [body.code, body.name, body.description ?? null, body.kind],
        client
      )
    );
    res.status(201);
    return getTax(row!.id);
  }
);

export const updateTax = handler(
  {
    params: idParams,
    body: z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(400).nullish(),
        kind: kind.optional(),
        isActive: z.boolean().optional()
      })
      .refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE taxes SET name = COALESCE($2, name),
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                kind = COALESCE($5, kind), is_active = COALESCE($6, is_active), updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.name ?? null, body.description !== undefined, body.description ?? null, body.kind ?? null, body.isActive ?? null],
        client
      )
    );
    if (!row) throw notFound();
    return getTax(params.id);
  }
);

/** Borra el impuesto y sus tarifas; si algún tratamiento usa una tarifa, la FK responde 409 IN_USE */
export const deleteTax = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM taxes WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound();
  return undefined;
});

// ------------------------------------------------------------------ Tarifas

export const createTaxRate = handler(
  {
    params: idParams,
    body: z.object({ code, name: z.string().trim().min(2).max(80), rate: rateValue, account })
  },
  async ({ params, body, req, res }) => {
    if (!(await one(`SELECT 1 FROM taxes WHERE id = $1`, [params.id]))) throw notFound("Impuesto no encontrado");
    await withTx(txCtx(req), (client) =>
      client.query(
        `INSERT INTO taxes_rates (tax_id, code, name, rate, account, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM taxes_rates WHERE tax_id = $1),
                 fn_current_app_user(), fn_current_app_user())`,
        [params.id, body.code, body.name, body.rate, body.account ?? null]
      )
    );
    res.status(201);
    return getTax(params.id);
  }
);

export const updateTaxRate = handler(
  {
    params: z.object({ rateId: z.uuid() }),
    body: z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        rate: rateValue.optional(),
        account,
        isActive: z.boolean().optional()
      })
      .refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ tax_id: string }>(
        `UPDATE taxes_rates SET name = COALESCE($2, name), rate = COALESCE($3, rate),
                account = CASE WHEN $4::boolean THEN $5 ELSE account END,
                is_active = COALESCE($6, is_active), updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING tax_id`,
        [params.rateId, body.name ?? null, body.rate ?? null, body.account !== undefined, body.account ?? null, body.isActive ?? null],
        client
      )
    );
    if (!row) throw notFound("Tarifa no encontrada");
    return getTax(row.tax_id);
  }
);

export const deleteTaxRate = handler({ params: z.object({ rateId: z.uuid() }) }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM taxes_rates WHERE id = $1 RETURNING id`, [params.rateId], client)
  );
  if (!row) throw notFound("Tarifa no encontrada");
  return undefined;
});
