/**
 * @project FabriHub - API
 * @file src/modules/inventory/warehouses.ts
 * @description Almacenes y políticas de stock mín/máx (INV_WAREHOUSES) — tesis: Clase Almacén
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "./scope.js";

const SELECT = `SELECT w.id, w.code, w.name, w.description, w.address, w.kind, w.is_active AS "isActive",
  w.order_list AS "orderList", w.updated_at AS "updatedAt",
  (SELECT COUNT(*) FROM stock_valuation v WHERE v.warehouse_id = w.id AND v.quantity <> 0)::int AS "productsWithStock",
  COALESCE((SELECT SUM(v.total_value) FROM stock_valuation v WHERE v.warehouse_id = w.id), 0)::float AS "stockValue",
  (SELECT COUNT(*) FROM stock_policies sp WHERE sp.warehouse_id = w.id)::int AS "policies",
  (SELECT COUNT(*) FROM users_warehouses uw WHERE uw.warehouse_id = w.id)::int AS "users"
  FROM warehouses w`;

export const listWarehouses = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  return query(`${SELECT} WHERE ($1::uuid[] IS NULL OR w.id = ANY($1)) ORDER BY w.order_list, w.code`, [scope]);
});

const fields = {
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullish(),
  address: z.string().trim().max(400).nullish(),
  kind: z.enum(["storage", "production", "transit"])
};

export const createWarehouse = handler(
  {
    body: z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)"),
      ...fields
    })
  },
  async ({ body: b, req, res }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO warehouses (code, name, description, address, kind, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM warehouses),
                 fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [b.code, b.name, b.description ?? null, b.address ?? null, b.kind],
        client
      )
    );
    res.status(201);
    return one(`${SELECT} WHERE w.id = $1`, [row!.id]);
  }
);

export const updateWarehouse = handler(
  {
    params: idParams,
    body: z.object({ ...fields, isActive: z.boolean() }).partial().refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body: b, req }) => {
    assertInScope(await warehouseScope(req), params.id);
    if (b.isActive === false) {
      const stock = await one(`SELECT 1 FROM stock_valuation WHERE warehouse_id = $1 AND quantity <> 0 LIMIT 1`, [params.id]);
      if (stock) throw badRequest("HAS_STOCK", "No se desactiva un almacén con existencia: trasládela primero");
    }
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE warehouses SET name = COALESCE($2, name),
                description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                address = CASE WHEN $5::boolean THEN $6 ELSE address END,
                kind = COALESCE($7, kind), is_active = COALESCE($8, is_active), updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, b.name ?? null, b.description !== undefined, b.description ?? null, b.address !== undefined, b.address ?? null, b.kind ?? null, b.isActive ?? null],
        client
      )
    );
    if (!row) throw notFound("Almacén no encontrado");
    return one(`${SELECT} WHERE w.id = $1`, [params.id]);
  }
);

export const deleteWarehouse = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM warehouses WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Almacén no encontrado");
  return undefined;
});

// ------------------------------------------------------------------ Políticas de stock (mín / máx)

export const listPolicies = handler({ params: idParams }, async ({ params, req }) => {
  assertInScope(await warehouseScope(req), params.id);
  return query(
    `SELECT sp.product_id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
            sp.min_qty::float AS "minQty", sp.max_qty::float AS "maxQty",
            COALESCE(v.quantity, 0)::float AS quantity,
            CASE WHEN COALESCE(v.quantity, 0) < sp.min_qty THEN 'below_min'
                 WHEN sp.max_qty IS NOT NULL AND COALESCE(v.quantity, 0) > sp.max_qty THEN 'above_max'
                 ELSE 'ok' END AS status
       FROM stock_policies sp
       JOIN products p ON p.id = sp.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN stock_valuation v ON v.warehouse_id = sp.warehouse_id AND v.product_id = sp.product_id
      WHERE sp.warehouse_id = $1 ORDER BY p.code`,
    [params.id]
  );
});

export const upsertPolicy = handler(
  {
    params: z.object({ id: z.uuid(), productId: z.uuid() }),
    body: z
      .object({ minQty: z.number().min(0).max(1e12), maxQty: z.number().min(0).max(1e12).nullish() })
      .refine((b) => b.maxQty === null || b.maxQty === undefined || b.maxQty >= b.minQty, "El máximo no puede ser menor que el mínimo")
  },
  async ({ params, body, req }) => {
    assertInScope(await warehouseScope(req), params.id);
    const product = await one<{ is_stockable: boolean }>(`SELECT is_stockable FROM products WHERE id = $1`, [params.productId]);
    if (!product) throw notFound("Producto no encontrado");
    if (!product.is_stockable) throw badRequest("NOT_STOCKABLE", "El producto no es inventariable");
    await withTx(txCtx(req), (client) =>
      client.query(
        `INSERT INTO stock_policies (warehouse_id, product_id, min_qty, max_qty, updated_by)
         VALUES ($1, $2, $3, $4, fn_current_app_user())
         ON CONFLICT (warehouse_id, product_id) DO UPDATE
            SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [params.id, params.productId, body.minQty, body.maxQty ?? null]
      )
    );
    return undefined;
  }
);

export const deletePolicy = handler({ params: z.object({ id: z.uuid(), productId: z.uuid() }) }, async ({ params, req }) => {
  assertInScope(await warehouseScope(req), params.id);
  await withTx(txCtx(req), (client) =>
    client.query(`DELETE FROM stock_policies WHERE warehouse_id = $1 AND product_id = $2`, [params.id, params.productId])
  );
  return undefined;
});
