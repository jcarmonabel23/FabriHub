/**
 * @project FabriHub - API
 * @file src/modules/lookups/routes.ts
 * @description GET /lookups/:catalog — opciones {id, code, name} para los <Select> de otros módulos
 *
 * @overview
 * Un formulario de proveedores (fase 4) necesita la lista de zonas o de condiciones de pago,
 * aunque el usuario no tenga acceso a la pantalla Catálogos comerciales. Por eso esta lectura
 * solo exige sesión: devuelve únicamente registros ACTIVOS y solo datos de identificación
 * (nunca costos ni existencias).
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../../db.js";
import { handler } from "../../lib/http.js";

const SOURCES: Record<string, { sql: string; appliesTo?: boolean; orderBy?: string }> = {
  currencies: { sql: `SELECT id, code, name, symbol FROM catalogs_currencies WHERE is_active` },
  "payment-terms": { sql: `SELECT id, code, name, days FROM catalogs_payment_terms WHERE is_active`, appliesTo: true },
  "delivery-terms": { sql: `SELECT id, code, name FROM catalogs_delivery_terms WHERE is_active`, appliesTo: true },
  "delivery-methods": { sql: `SELECT id, code, name FROM catalogs_delivery_methods WHERE is_active`, appliesTo: true },
  "business-types": { sql: `SELECT id, code, name FROM catalogs_business_types WHERE is_active`, appliesTo: true },
  zones: { sql: `SELECT id, code, name FROM catalogs_zones WHERE is_active` },
  "fiscal-treatments": {
    sql: `SELECT id, code, name FROM fiscal_treatments
           WHERE is_active AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`
  },
  // Inventario (fase 3)
  units: { sql: `SELECT id, code, name, decimals FROM catalogs_units WHERE is_active` },
  "product-types": { sql: `SELECT id, code, name, nature FROM catalogs_product_types WHERE is_active` },
  "product-families": { sql: `SELECT id, code, name FROM catalogs_product_families WHERE is_active` },
  "product-categories": { sql: `SELECT id, code, name FROM catalogs_product_categories WHERE is_active` },
  "movement-types": { sql: `SELECT id, code, name, direction FROM catalogs_movement_types WHERE is_active` },
  warehouses: { sql: `SELECT id, code, name, kind FROM warehouses WHERE is_active` },
  // Compras (fase 4)
  buyers: { sql: `SELECT id, code, name FROM buyers WHERE is_active` },
  suppliers: { sql: `SELECT id, code, legal_name AS name, rif FROM suppliers WHERE is_active`, orderBy: "legal_name" },
  "purchase-price-lists": { sql: `SELECT id, code, name FROM price_lists WHERE is_active AND scope = 'purchases'`, orderBy: "code" },
  // Producción (fase 5)
  stages: { sql: `SELECT id, code, name FROM stages WHERE is_active` },
  "work-center-types": { sql: `SELECT id, code, name FROM catalogs_work_center_types WHERE is_active` },
  "production-centers": { sql: `SELECT id, code, name FROM production_centers WHERE is_active` },
  "work-centers": { sql: `SELECT id, code, name, production_center_id AS "productionCenterId" FROM work_centers WHERE is_active` },
  routes: { sql: `SELECT id, code, name FROM routes WHERE is_active`, orderBy: "code" },
  // Ventas (fase 6)
  sellers: { sql: `SELECT id, code, name FROM sellers WHERE is_active` },
  customers: { sql: `SELECT id, code, legal_name AS name, rif FROM customers WHERE is_active`, orderBy: "legal_name" },
  "sales-price-lists": { sql: `SELECT id, code, name FROM price_lists WHERE is_active AND scope = 'sales'`, orderBy: "code" }
};

const lookup = handler(
  {
    params: z.object({ catalog: z.enum(Object.keys(SOURCES) as [string, ...string[]]) }),
    query: z.object({ appliesTo: z.enum(["purchases", "sales"]).optional() })
  },
  ({ params, query: q }) => {
    const src = SOURCES[params.catalog];
    if (src.appliesTo && q.appliesTo) {
      return query(`${src.sql} AND applies_to IN ($1, 'both') ORDER BY ${src.orderBy ?? "order_list, name"}`, [q.appliesTo]);
    }
    return query(`${src.sql} ORDER BY ${src.orderBy ?? "order_list, name"}`);
  }
);

/** Productos para buscadores: hasta 30 coincidencias por código o nombre */
const productsLookup = handler(
  {
    query: z.object({
      search: z.string().trim().max(80).optional(),
      stockable: z.enum(["true", "false"]).optional(),
      purchased: z.enum(["true"]).optional(),
      sold: z.enum(["true"]).optional(),
      manufactured: z.enum(["true"]).optional(),
      ids: z.string().max(4000).optional()
    })
  },
  ({ query: q }) => {
    const ids = q.ids ? q.ids.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : null;
    return query(
      `SELECT p.id, p.code, p.name, u.code AS "unitCode", u.decimals AS "unitDecimals",
              p.is_lot_controlled AS "isLotControlled", p.is_stockable AS "isStockable",
              p.shelf_life_days AS "shelfLifeDays", p.is_on_hold AS "isOnHold",
              p.stock_unit_id AS "stockUnitId", p.purchase_unit_id AS "purchaseUnitId", pu.code AS "purchaseUnitCode",
              p.purchase_factor::float AS "purchaseFactor", p.sale_unit_id AS "saleUnitId", su.code AS "saleUnitCode",
              p.sale_factor::float AS "saleFactor", p.is_manufactured AS "isManufactured"
         FROM products p JOIN catalogs_units u ON u.id = p.stock_unit_id
         LEFT JOIN catalogs_units pu ON pu.id = p.purchase_unit_id
         LEFT JOIN catalogs_units su ON su.id = p.sale_unit_id
        WHERE p.is_active
          AND ($1::text IS NULL OR p.code ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%')
          AND ($2::boolean IS NULL OR p.is_stockable = $2)
          AND ($3::uuid[] IS NULL OR p.id = ANY($3))
          AND ($4::boolean IS NULL OR p.is_purchased)
          AND ($5::boolean IS NULL OR p.is_sold)
          AND ($6::boolean IS NULL OR p.is_manufactured)
        ORDER BY p.code LIMIT 30`,
      [q.search || null, q.stockable === undefined ? null : q.stockable === "true", ids, q.purchased ? true : null, q.sold ? true : null, q.manufactured ? true : null]
    );
  }
);

export const lookupsRoutes = Router();
lookupsRoutes.get("/products", productsLookup);
lookupsRoutes.get("/:catalog", lookup);
