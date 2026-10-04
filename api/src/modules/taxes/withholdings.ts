/**
 * @project FabriHub - API
 * @file src/modules/taxes/withholdings.ts
 * @description Retenciones, tarifas y tramos (TAX_WITHHOLDINGS)
 *
 * Los tramos de una tarifa se guardan siempre como conjunto completo (se reemplazan en una
 * transacción): así nunca queda una tarifa a medio editar.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)");
const account = z
  .string()
  .trim()
  .max(30)
  .transform((v) => v || null)
  .nullish();

export const bracketsSchema = z
  .array(
    z.object({
      fromAmount: z.number().min(0).max(1e15),
      rate: z.number().min(0).max(100),
      subtrahend: z.number().min(0).max(1e15).default(0)
    })
  )
  .min(1, "Defina al menos un tramo")
  .max(20)
  .refine((b) => new Set(b.map((x) => x.fromAmount)).size === b.length, "Hay tramos con el mismo monto base");

const LIST = `SELECT w.id, w.code, w.name, w.description, w.kind, w.base_on AS "baseOn", w.is_active AS "isActive",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'code', r.code, 'name', r.name, 'account', r.account, 'isActive', r.is_active,
      'treatments', (SELECT COUNT(*) FROM fiscal_treatments f WHERE f.withholding_rate_id = r.id),
      'brackets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'fromAmount', b.from_amount::float, 'rate', b.rate::float, 'subtrahend', b.subtrahend::float)
          ORDER BY b.from_amount) FROM withholdings_brackets b WHERE b.withholding_rate_id = r.id), '[]')
    ) ORDER BY r.order_list, r.code)
    FROM withholdings_rates r WHERE r.withholding_id = w.id), '[]') AS rates
  FROM withholdings w`;

export const listWithholdings = handler({}, () => query(`${LIST} ORDER BY w.order_list, w.code`));
const getWithholding = (id: string) => one(`${LIST} WHERE w.id = $1`, [id]);

export const createWithholding = handler(
  {
    body: z.object({
      code,
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(400).nullish(),
      kind: z.enum(["vat", "income", "other"]),
      baseOn: z.enum(["amount", "tax"])
    })
  },
  async ({ body, req, res }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO withholdings (code, name, description, kind, base_on, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM withholdings),
                 fn_current_app_user(), fn_current_app_user())
         RETURNING id`,
        [body.code, body.name, body.description ?? null, body.kind, body.baseOn],
        client
      )
    );
    res.status(201);
    return getWithholding(row!.id);
  }
);

export const updateWithholding = handler(
  {
    params: idParams,
    body: z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(400).nullish(),
        baseOn: z.enum(["amount", "tax"]).optional(),
        isActive: z.boolean().optional()
      })
      .refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE withholdings SET name = COALESCE($2, name),
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                base_on = COALESCE($5, base_on), is_active = COALESCE($6, is_active), updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.name ?? null, body.description !== undefined, body.description ?? null, body.baseOn ?? null, body.isActive ?? null],
        client
      )
    );
    if (!row) throw notFound();
    return getWithholding(params.id);
  }
);

export const deleteWithholding = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM withholdings WHERE id = $1 RETURNING id`, [params.id], client)
  );
  if (!row) throw notFound();
  return undefined;
});

// ------------------------------------------------------------------ Tarifas con tramos

async function replaceBrackets(client: pg.PoolClient, rateId: string, brackets: z.infer<typeof bracketsSchema>) {
  await client.query(`DELETE FROM withholdings_brackets WHERE withholding_rate_id = $1`, [rateId]);
  for (const b of brackets) {
    await client.query(
      `INSERT INTO withholdings_brackets (withholding_rate_id, from_amount, rate, subtrahend) VALUES ($1, $2, $3, $4)`,
      [rateId, b.fromAmount, b.rate, b.subtrahend]
    );
  }
}

export const createWithholdingRate = handler(
  {
    params: idParams,
    body: z.object({ code, name: z.string().trim().min(2).max(120), account, brackets: bracketsSchema })
  },
  async ({ params, body, req, res }) => {
    if (!(await one(`SELECT 1 FROM withholdings WHERE id = $1`, [params.id]))) throw notFound("Retención no encontrada");
    await withTx(txCtx(req), async (client) => {
      const rate = await one<{ id: string }>(
        `INSERT INTO withholdings_rates (withholding_id, code, name, account, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM withholdings_rates WHERE withholding_id = $1),
                 fn_current_app_user(), fn_current_app_user())
         RETURNING id`,
        [params.id, body.code, body.name, body.account ?? null],
        client
      );
      await replaceBrackets(client, rate!.id, body.brackets);
    });
    res.status(201);
    return getWithholding(params.id);
  }
);

export const updateWithholdingRate = handler(
  {
    params: z.object({ rateId: z.uuid() }),
    body: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        account,
        isActive: z.boolean().optional(),
        brackets: bracketsSchema.optional()
      })
      .refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body, req }) => {
    const whId = await withTx(txCtx(req), async (client) => {
      const row = await one<{ withholding_id: string }>(
        `UPDATE withholdings_rates SET name = COALESCE($2, name),
                account = CASE WHEN $3::boolean THEN $4 ELSE account END,
                is_active = COALESCE($5, is_active), updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING withholding_id`,
        [params.rateId, body.name ?? null, body.account !== undefined, body.account ?? null, body.isActive ?? null],
        client
      );
      if (!row) throw notFound("Tarifa no encontrada");
      if (body.brackets) await replaceBrackets(client, params.rateId, body.brackets);
      return row.withholding_id;
    });
    return getWithholding(whId);
  }
);

export const deleteWithholdingRate = handler({ params: z.object({ rateId: z.uuid() }) }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM withholdings_rates WHERE id = $1 RETURNING id`, [params.rateId], client)
  );
  if (!row) throw notFound("Tarifa no encontrada");
  return undefined;
});
