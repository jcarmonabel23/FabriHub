/**
 * @project FabriHub - API
 * @file src/modules/pricing/priceLists.ts
 * @description Listas de precios (tesis: Lista de Precios Proveedor / Cliente) — un solo motor,
 * montado dos veces: Compras (PUR_PRICE_LISTS, scope purchases) y Ventas (fase 6, scope sales)
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx, type Db } from "../../db.js";
import { badRequest, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission as can } from "../../security/authorize.js";
import { txCtx } from "../../security/context.js";
import { exchangeRate } from "../purchases/fiscal.js";

export type PriceScope = "purchases" | "sales";

const SELECT = `SELECT l.id, l.code, l.name, l.scope, l.is_active AS "isActive", l.currency_id AS "currencyId",
  c.code AS "currencyCode", to_char(l.valid_from, 'YYYY-MM-DD') AS "validFrom", to_char(l.valid_to, 'YYYY-MM-DD') AS "validTo",
  l.notes, l.updated_at AS "updatedAt",
  (SELECT COUNT(*) FROM price_lists_items i WHERE i.price_list_id = l.id)::int AS "items",
  ((SELECT COUNT(*) FROM suppliers s WHERE s.price_list_id = l.id) + (SELECT COUNT(*) FROM customers cu WHERE cu.price_list_id = l.id))::int AS "parties"
  FROM price_lists l JOIN catalogs_currencies c ON c.id = l.currency_id`;

const dateOpt = z.iso.date().nullish();
const fields = {
  name: z.string().trim().min(2).max(120),
  currencyId: z.uuid(),
  validFrom: dateOpt,
  validTo: dateOpt,
  notes: z.string().trim().max(400).nullish()
};

export function priceListRoutes(scope: PriceScope, module: string): Router {
  const r = Router();

  const list = handler({}, () => query(`${SELECT} WHERE l.scope = $1 ORDER BY l.code`, [scope]));

  const create = handler(
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
      if (b.validFrom && b.validTo && b.validTo < b.validFrom) throw badRequest("INVALID_VALIDITY", "Fin anterior al inicio");
      const row = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO price_lists (code, name, scope, currency_id, valid_from, valid_to, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
          [b.code, b.name, scope, b.currencyId, b.validFrom ?? null, b.validTo ?? null, b.notes ?? null],
          client
        )
      );
      res.status(201);
      return one(`${SELECT} WHERE l.id = $1`, [row!.id]);
    }
  );

  const update = handler(
    {
      params: idParams,
      body: z.object({ ...fields, isActive: z.boolean() }).partial().refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
    },
    async ({ params, body: b, req }) => {
      const row = await withTx(txCtx(req), (client) =>
        one(
          `UPDATE price_lists SET name = COALESCE($3, name), currency_id = COALESCE($4, currency_id),
                  valid_from = CASE WHEN $5::boolean THEN $6::date ELSE valid_from END,
                  valid_to = CASE WHEN $7::boolean THEN $8::date ELSE valid_to END,
                  notes = CASE WHEN $9::boolean THEN $10 ELSE notes END,
                  is_active = COALESCE($11, is_active), updated_by = fn_current_app_user()
            WHERE id = $1 AND scope = $2 RETURNING id`,
          [
            params.id,
            scope,
            b.name ?? null,
            b.currencyId ?? null,
            b.validFrom !== undefined,
            b.validFrom ?? null,
            b.validTo !== undefined,
            b.validTo ?? null,
            b.notes !== undefined,
            b.notes ?? null,
            b.isActive ?? null
          ],
          client
        )
      );
      if (!row) throw notFound("Lista no encontrada");
      return one(`${SELECT} WHERE l.id = $1`, [params.id]);
    }
  );

  const remove = handler({ params: idParams }, async ({ params, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(`DELETE FROM price_lists WHERE id = $1 AND scope = $2 RETURNING id`, [params.id, scope], client)
    );
    if (!row) throw notFound("Lista no encontrada");
    return undefined;
  });

  const items = handler({ params: idParams }, ({ params }) =>
    query(
      `SELECT i.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
              COALESCE(iu.code, pu.code, su.code) AS "unitCode",
              i.price::float AS price, i.promo_price::float AS "promoPrice",
              to_char(i.promo_from, 'YYYY-MM-DD') AS "promoFrom", to_char(i.promo_to, 'YYYY-MM-DD') AS "promoTo",
              (i.promo_price IS NOT NULL AND CURRENT_DATE BETWEEN i.promo_from AND i.promo_to) AS "promoActive"
         FROM price_lists_items i
         JOIN price_lists l ON l.id = i.price_list_id
         JOIN products p ON p.id = i.product_id
         JOIN catalogs_units su ON su.id = p.stock_unit_id
         LEFT JOIN catalogs_units pu ON pu.id = CASE WHEN l.scope = 'purchases' THEN p.purchase_unit_id ELSE p.sale_unit_id END
         LEFT JOIN catalogs_units iu ON iu.id = i.unit_id
        WHERE i.price_list_id = $1 ORDER BY p.code`,
      [params.id]
    )
  );

  const upsertItem = handler(
    {
      params: z.object({ id: z.uuid(), productId: z.uuid() }),
      body: z
        .object({
          price: z.number().min(0).max(1e12),
          promoPrice: z.number().min(0).max(1e12).nullish(),
          promoFrom: dateOpt,
          promoTo: dateOpt
        })
        .refine((b) => !b.promoPrice || (b.promoFrom && b.promoTo && b.promoTo >= b.promoFrom), "La promoción necesita fechas válidas")
    },
    async ({ params, body: b, req }) => {
      const list = await one(`SELECT 1 FROM price_lists WHERE id = $1 AND scope = $2`, [params.id, scope]);
      if (!list) throw notFound("Lista no encontrada");
      await withTx(txCtx(req), (client) =>
        client.query(
          `INSERT INTO price_lists_items (price_list_id, product_id, price, promo_price, promo_from, promo_to, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user())
           ON CONFLICT (price_list_id, product_id) DO UPDATE
              SET price = EXCLUDED.price, promo_price = EXCLUDED.promo_price, promo_from = EXCLUDED.promo_from,
                  promo_to = EXCLUDED.promo_to, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [params.id, params.productId, b.price, b.promoPrice ?? null, b.promoPrice ? b.promoFrom : null, b.promoPrice ? b.promoTo : null]
        )
      );
      return undefined;
    }
  );

  const deleteItem = handler({ params: z.object({ id: z.uuid(), productId: z.uuid() }) }, async ({ params, req }) => {
    await withTx(txCtx(req), (client) =>
      client.query(`DELETE FROM price_lists_items WHERE price_list_id = $1 AND product_id = $2`, [params.id, params.productId])
    );
    return undefined;
  });

  r.get("/", can(module, "view"), list);
  r.post("/", can(module, "add_new"), create);
  r.patch("/:id", can(module, "edit"), update);
  r.delete("/:id", can(module, "delete"), remove);
  r.get("/:id/items", can(module, "view"), items);
  r.put("/:id/items/:productId", can(module, "edit"), upsertItem);
  r.delete("/:id/items/:productId", can(module, "edit"), deleteItem);
  return r;
}

/**
 * @function suggestPrice
 * @description Precio sugerido para una línea: promoción vigente → precio de lista → precio de
 * referencia del producto. Si la lista está en otra moneda, se convierte a la del documento.
 */
export async function suggestPrice(
  db: Db,
  args: { priceListId: string | null; productId: string; date: string; currencyId: string; productRefPrice: number | null }
): Promise<{ price: number | null; source: "promo" | "list" | "product" | null }> {
  if (args.priceListId) {
    const item = await one<{ price: string; promo: string | null; currency_id: string; list_ok: boolean }>(
      `SELECT i.price, CASE WHEN i.promo_price IS NOT NULL AND $3::date BETWEEN i.promo_from AND i.promo_to THEN i.promo_price END AS promo,
              l.currency_id,
              (l.is_active AND (l.valid_from IS NULL OR l.valid_from <= $3::date) AND (l.valid_to IS NULL OR l.valid_to >= $3::date)) AS list_ok
         FROM price_lists_items i JOIN price_lists l ON l.id = i.price_list_id
        WHERE i.price_list_id = $1 AND i.product_id = $2`,
      [args.priceListId, args.productId, args.date],
      db
    );
    if (item?.list_ok) {
      let price = Number(item.promo ?? item.price);
      if (item.currency_id !== args.currencyId) {
        const from = await exchangeRate(db, item.currency_id, args.date);
        const to = await exchangeRate(db, args.currencyId, args.date);
        price = Math.round(((price * from) / to) * 10000) / 10000;
      }
      return { price, source: item.promo ? "promo" : "list" };
    }
  }
  if (args.productRefPrice !== null) {
    // El precio de referencia del producto está en moneda base.
    const to = await exchangeRate(db, args.currencyId, args.date);
    return { price: Math.round((args.productRefPrice / to) * 10000) / 10000, source: "product" };
  }
  return { price: null, source: null };
}
