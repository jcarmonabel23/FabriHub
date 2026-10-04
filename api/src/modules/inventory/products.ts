/**
 * @project FabriHub - API
 * @file src/modules/inventory/products.ts
 * @description Maestro de productos (INV_PRODUCTS) — tesis: Clase Productos
 *
 * @overview
 * Reglas que protegen la integridad del inventario:
 *  - Un servicio nunca es inventariable ni se maneja por lote.
 *  - Con existencia o movimientos no se cambia la unidad de almacén ni el manejo por lote
 *    (las cantidades históricas quedarían en otra unidad o sin lote).
 *  - "Cantidad Total" de la tesis no se guarda: se calcula de stock_valuation (sin redundancia).
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { warehouseScope } from "./scope.js";

const money = z.number().min(0).max(1e13).nullish();
const factor = z.number().positive().max(1e9);

const productFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(800).nullish(),
  productTypeId: z.uuid(),
  familyId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  stockUnitId: z.uuid(),
  purchaseUnitId: z.uuid().nullish(),
  purchaseFactor: factor.default(1),
  saleUnitId: z.uuid().nullish(),
  saleFactor: factor.default(1),
  productionUnitId: z.uuid().nullish(),
  productionFactor: factor.default(1),
  isStockable: z.boolean().default(true),
  isLotControlled: z.boolean().default(false),
  isPurchased: z.boolean().default(false),
  isSold: z.boolean().default(false),
  isManufactured: z.boolean().default(false),
  isOnHold: z.boolean().default(false),
  shelfLifeDays: z.number().int().positive().max(36500).nullish(),
  fiscalTreatmentId: z.uuid().nullish(),
  salePrice: money,
  purchasePrice: money,
  standardCost: money
};

const createBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9._-]{1,30}$/, "Solo mayúsculas, números, punto, - y _ (máx. 30)"),
  ...productFields
});
const updateBody = z
  .object({ ...productFields, isActive: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

/** Columna BD de cada campo de la API (lista blanca para el UPDATE dinámico) */
const COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  productTypeId: "product_type_id",
  familyId: "family_id",
  categoryId: "category_id",
  tags: "tags",
  stockUnitId: "stock_unit_id",
  purchaseUnitId: "purchase_unit_id",
  purchaseFactor: "purchase_factor",
  saleUnitId: "sale_unit_id",
  saleFactor: "sale_factor",
  productionUnitId: "production_unit_id",
  productionFactor: "production_factor",
  isStockable: "is_stockable",
  isLotControlled: "is_lot_controlled",
  isPurchased: "is_purchased",
  isSold: "is_sold",
  isManufactured: "is_manufactured",
  isOnHold: "is_on_hold",
  shelfLifeDays: "shelf_life_days",
  fiscalTreatmentId: "fiscal_treatment_id",
  salePrice: "sale_price",
  purchasePrice: "purchase_price",
  standardCost: "standard_cost",
  isActive: "is_active"
};

/** Normaliza banderas según la naturaleza del tipo: un servicio no es inventariable ni lleva lote */
async function normalizeFlags(db: pg.PoolClient, b: Record<string, unknown>, typeId: string) {
  const type = await one<{ nature: string }>(`SELECT nature FROM catalogs_product_types WHERE id = $1`, [typeId], db);
  if (!type) throw badRequest("INVALID_TYPE", "Tipo de producto inexistente");
  if (type.nature === "service") {
    b.isStockable = false;
    b.isLotControlled = false;
  }
  if (b.isLotControlled && b.isStockable === false) {
    throw badRequest("LOT_NEEDS_STOCK", "Un producto manejado por lote debe ser inventariable");
  }
}

const SELECT = `
  SELECT p.id, p.code, p.name, p.description, p.is_active AS "isActive", p.tags,
         p.product_type_id AS "productTypeId", t.code AS "typeCode", t.name AS "typeName", t.nature,
         p.family_id AS "familyId", f.name AS "familyName", p.category_id AS "categoryId", c.name AS "categoryName",
         p.stock_unit_id AS "stockUnitId", u.code AS "stockUnitCode", u.decimals AS "unitDecimals",
         p.purchase_unit_id AS "purchaseUnitId", p.purchase_factor::float AS "purchaseFactor",
         p.sale_unit_id AS "saleUnitId", p.sale_factor::float AS "saleFactor",
         p.production_unit_id AS "productionUnitId", p.production_factor::float AS "productionFactor",
         p.is_stockable AS "isStockable", p.is_lot_controlled AS "isLotControlled", p.is_purchased AS "isPurchased",
         p.is_sold AS "isSold", p.is_manufactured AS "isManufactured", p.is_on_hold AS "isOnHold",
         p.shelf_life_days AS "shelfLifeDays", p.fiscal_treatment_id AS "fiscalTreatmentId", ft.code AS "fiscalTreatmentCode",
         p.sale_price::float AS "salePrice", p.purchase_price::float AS "purchasePrice", p.standard_cost::float AS "standardCost",
         p.updated_at AS "updatedAt",
         COALESCE((SELECT SUM(v.quantity) FROM stock_valuation v
                    WHERE v.product_id = p.id AND ($1::uuid[] IS NULL OR v.warehouse_id = ANY($1))), 0)::float AS "totalQuantity"
    FROM products p
    JOIN catalogs_product_types t ON t.id = p.product_type_id
    JOIN catalogs_units u ON u.id = p.stock_unit_id
    LEFT JOIN catalogs_product_families f ON f.id = p.family_id
    LEFT JOIN catalogs_product_categories c ON c.id = p.category_id
    LEFT JOIN fiscal_treatments ft ON ft.id = p.fiscal_treatment_id`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(80).optional(),
  typeId: z.uuid().optional(),
  familyId: z.uuid().optional(),
  active: z.enum(["true", "false"]).optional()
});

export const listProducts = handler({ query: listQuery }, async ({ query: q, req }) => {
  const scope = await warehouseScope(req);
  const rows = await query(
    `SELECT *, COUNT(*) OVER()::int AS total FROM (${SELECT}) x
      WHERE ($2::text IS NULL OR x.code ILIKE '%' || $2 || '%' OR x.name ILIKE '%' || $2 || '%')
        AND ($3::uuid IS NULL OR x."productTypeId" = $3)
        AND ($4::uuid IS NULL OR x."familyId" = $4)
        AND ($5::boolean IS NULL OR x."isActive" = $5)
      ORDER BY x.code LIMIT $6 OFFSET $7`,
    [scope, q.search || null, q.typeId ?? null, q.familyId ?? null, q.active === undefined ? null : q.active === "true", q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function productDetail(id: string, scope: string[] | null) {
  const product = await one(`${SELECT} WHERE p.id = $2`, [scope, id]);
  if (!product) throw notFound("Producto no encontrado");
  const [relations, stock] = await Promise.all([
    query(
      `SELECT r.id, r.kind, to_char(r.valid_from, 'YYYY-MM-DD') AS "validFrom", r.notes,
              r.related_product_id AS "relatedProductId", p.code AS "relatedCode", p.name AS "relatedName"
         FROM products_relations r JOIN products p ON p.id = r.related_product_id
        WHERE r.product_id = $1 ORDER BY r.kind, p.code`,
      [id]
    ),
    query(
      `SELECT w.id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
              v.quantity::float AS quantity, CASE WHEN v.quantity > 0 THEN (v.total_value / v.quantity)::float ELSE 0 END AS "avgCost",
              v.total_value::float AS value
         FROM stock_valuation v JOIN warehouses w ON w.id = v.warehouse_id
        WHERE v.product_id = $1 AND v.quantity <> 0 AND ($2::uuid[] IS NULL OR v.warehouse_id = ANY($2))
        ORDER BY w.order_list`,
      [id, scope]
    )
  ]);
  return { ...product, relations, stock };
}

export const getProduct = handler({ params: idParams }, async ({ params, req }) =>
  productDetail(params.id, await warehouseScope(req))
);

export const createProduct = handler({ body: createBody }, async ({ body, req, res }) => {
  const created = await withTx(txCtx(req), async (client) => {
    const b = { ...body } as Record<string, unknown>;
    await normalizeFlags(client, b, body.productTypeId);
    const keys = Object.keys(COLUMNS).filter((k) => k !== "isActive" && b[k] !== undefined);
    const cols = ["code", ...keys.map((k) => COLUMNS[k])];
    const values = [body.code, ...keys.map((k) => b[k] ?? null)];
    return one<{ id: string }>(
      `INSERT INTO products (${cols.join(", ")}, created_by, updated_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, fn_current_app_user(), fn_current_app_user())
       RETURNING id`,
      values,
      client
    );
  });
  res.status(201);
  return productDetail(created!.id, await warehouseScope(req));
});

export const updateProduct = handler({ params: idParams, body: updateBody }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const current = await one<{
      product_type_id: string;
      stock_unit_id: string;
      is_lot_controlled: boolean;
      is_stockable: boolean;
      has_history: boolean;
    }>(
      `SELECT product_type_id, stock_unit_id, is_lot_controlled, is_stockable,
              EXISTS (SELECT 1 FROM inventory_movements_details d WHERE d.product_id = p.id) AS has_history
         FROM products p WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!current) throw notFound("Producto no encontrado");

    const b = { ...body } as Record<string, unknown>;
    b.isStockable ??= current.is_stockable;
    b.isLotControlled ??= current.is_lot_controlled;
    await normalizeFlags(client, b, (body.productTypeId ?? current.product_type_id) as string);

    if (current.has_history) {
      const locked: string[] = [];
      if (body.stockUnitId && body.stockUnitId !== current.stock_unit_id) locked.push("la unidad de almacén");
      if (b.isLotControlled !== current.is_lot_controlled) locked.push("el manejo por lote");
      if (b.isStockable !== current.is_stockable) locked.push("si es inventariable");
      if (locked.length) {
        throw conflict("HAS_HISTORY", `El producto ya tiene movimientos: no se puede cambiar ${locked.join(", ")}`);
      }
    }

    const keys = Object.keys(b).filter((k) => COLUMNS[k] && b[k] !== undefined);
    await client.query(
      `UPDATE products SET ${[...keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`), "updated_by = fn_current_app_user()"].join(", ")}
        WHERE id = $1`,
      [params.id, ...keys.map((k) => b[k])]
    );
  });
  return productDetail(params.id, await warehouseScope(req));
});

/** Baja física solo si nunca se movió (la FK de lotes/movimientos responde 409 IN_USE) */
export const deleteProduct = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM products WHERE id = $1 RETURNING id`, [params.id], client)
  );
  if (!row) throw notFound("Producto no encontrado");
  return undefined;
});

const relationsBody = z.object({
  relations: z
    .array(
      z.object({
        relatedProductId: z.uuid(),
        kind: z.enum(["substitute", "complementary", "equivalent"]),
        validFrom: z.iso.date().nullish(),
        notes: z.string().trim().max(400).nullish()
      })
    )
    .max(30)
});

/** Sustitutos, complementarios y equivalentes: se reemplaza el conjunto completo */
export const setRelations = handler({ params: idParams, body: relationsBody }, async ({ params, body, req }) => {
  if (body.relations.some((r) => r.relatedProductId === params.id)) {
    throw badRequest("SELF_RELATION", "Un producto no se relaciona consigo mismo");
  }
  await withTx(txCtx(req), async (client) => {
    if (!(await one(`SELECT 1 FROM products WHERE id = $1`, [params.id], client))) throw notFound("Producto no encontrado");
    await client.query(`DELETE FROM products_relations WHERE product_id = $1`, [params.id]);
    for (const r of body.relations) {
      await client.query(
        `INSERT INTO products_relations (product_id, related_product_id, kind, valid_from, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, fn_current_app_user())`,
        [params.id, r.relatedProductId, r.kind, r.validFrom ?? null, r.notes ?? null]
      );
    }
  });
  return productDetail(params.id, await warehouseScope(req));
});
