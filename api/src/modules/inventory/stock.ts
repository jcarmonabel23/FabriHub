/**
 * @project FabriHub - API
 * @file src/modules/inventory/stock.ts
 * @description Existencias, kárdex y alertas (INV_STOCK)
 */

import { z } from "zod";
import { one, query } from "../../db.js";
import { handler, pageQuery } from "../../lib/http.js";
import { assertInScope, warehouseScope } from "./scope.js";

const stockQuery = pageQuery.extend({
  search: z.string().trim().max(80).optional(),
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  groupBy: z.enum(["lot", "product"]).default("lot")
});

/** Existencias por almacén + producto (+ lote). Disponible = existencia − reservado */
export const listStock = handler({ query: stockQuery }, async ({ query: q, req }) => {
  const scope = await warehouseScope(req);
  const byLot = q.groupBy === "lot";
  const rows = await query(
    `SELECT COUNT(*) OVER()::int AS total,
            w.id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
            p.id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
            ${byLot ? `l.id AS "lotId", l.lot_code AS "lotCode", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn", l.quality_status AS "qualityStatus",` : ""}
            SUM(b.quantity)::float AS quantity, SUM(b.reserved)::float AS reserved,
            (SUM(b.quantity) - SUM(b.reserved))::float AS available,
            CASE WHEN v.quantity > 0 THEN (v.total_value / v.quantity)::float ELSE 0 END AS "avgCost",
            (SUM(b.quantity) * CASE WHEN v.quantity > 0 THEN v.total_value / v.quantity ELSE 0 END)::float AS value
       FROM stock_balances b
       JOIN warehouses w ON w.id = b.warehouse_id
       JOIN products p ON p.id = b.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN lots l ON l.id = b.lot_id
       LEFT JOIN stock_valuation v ON v.warehouse_id = b.warehouse_id AND v.product_id = b.product_id
      WHERE b.quantity <> 0
        AND ($1::uuid[] IS NULL OR b.warehouse_id = ANY($1))
        AND ($2::uuid IS NULL OR b.warehouse_id = $2)
        AND ($3::uuid IS NULL OR b.product_id = $3)
        AND ($4::text IS NULL OR p.code ILIKE '%' || $4 || '%' OR p.name ILIKE '%' || $4 || '%' OR l.lot_code ILIKE '%' || $4 || '%')
      GROUP BY w.id, w.code, w.name, w.order_list, p.id, p.code, p.name, u.code, v.quantity, v.total_value
               ${byLot ? ", l.id, l.lot_code, l.expires_on, l.quality_status" : ""}
      ORDER BY w.order_list, p.code ${byLot ? ", l.expires_on NULLS LAST" : ""}
      LIMIT $5 OFFSET $6`,
    [scope, q.warehouseId ?? null, q.productId ?? null, q.search || null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

/** Indicadores de la cabecera de Existencias */
export const stockSummary = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  return one(
    `SELECT COALESCE(SUM(v.total_value), 0)::float AS "totalValue",
            COUNT(DISTINCT v.product_id) FILTER (WHERE v.quantity > 0)::int AS "productsWithStock",
            (SELECT COUNT(*) FROM v_stock_alerts a WHERE $1::uuid[] IS NULL OR a.warehouse_id = ANY($1))::int AS "stockAlerts",
            (SELECT COUNT(*) FROM v_lots_expiring)::int AS "lotAlerts"
       FROM stock_valuation v
      WHERE $1::uuid[] IS NULL OR v.warehouse_id = ANY($1)`,
    [scope]
  );
});

/** Kárdex: historia de un producto en un almacén con existencia y costo promedio corridos */
export const kardex = handler(
  {
    query: z.object({
      productId: z.uuid(),
      warehouseId: z.uuid(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional()
    })
  },
  async ({ query: q, req }) => {
    assertInScope(await warehouseScope(req), q.warehouseId);
    return query(
      `SELECT m.id AS "movementId", m.number, to_char(m.movement_date, 'YYYY-MM-DD') AS "movementDate", m.posted_at AS "postedAt",
              c.name AS "conceptName", m.status, l.lot_code AS "lotCode", d.line_no AS "lineNo",
              CASE WHEN m.warehouse_id = $2 AND m.direction = 'in' THEN d.quantity
                   WHEN m.target_warehouse_id = $2 THEN d.quantity ELSE 0 END::float AS "qtyIn",
              CASE WHEN m.warehouse_id = $2 AND m.direction IN ('out', 'transfer') THEN d.quantity ELSE 0 END::float AS "qtyOut",
              d.unit_cost::float AS "unitCost",
              CASE WHEN m.target_warehouse_id = $2 THEN d.target_balance_after ELSE d.balance_after END::float AS balance,
              CASE WHEN m.target_warehouse_id = $2 THEN d.target_avg_cost_after ELSE d.avg_cost_after END::float AS "avgCost",
              CASE WHEN m.direction = 'transfer' AND m.warehouse_id = $2 THEN 'a ' || tw.code
                   WHEN m.direction = 'transfer' THEN 'desde ' || w.code END AS counterpart
         FROM inventory_movements_details d
         JOIN inventory_movements m ON m.id = d.movement_id
         JOIN catalogs_movement_concepts c ON c.id = m.concept_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN warehouses tw ON tw.id = m.target_warehouse_id
         LEFT JOIN lots l ON l.id = d.lot_id
        WHERE d.product_id = $1 AND m.status <> 'draft'
          AND (m.warehouse_id = $2 OR m.target_warehouse_id = $2)
          AND ($3::date IS NULL OR m.movement_date >= $3)
          AND ($4::date IS NULL OR m.movement_date <= $4)
        ORDER BY m.posted_at, m.number, d.line_no`,
      [q.productId, q.warehouseId, q.from ?? null, q.to ?? null]
    );
  }
);

export const stockAlerts = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  const [stock, lots] = await Promise.all([
    query(
      `SELECT warehouse_id AS "warehouseId", warehouse_code AS "warehouseCode", warehouse_name AS "warehouseName",
              product_id AS "productId", product_code AS "productCode", product_name AS "productName", unit_code AS "unitCode",
              quantity::float AS quantity, min_qty::float AS "minQty", max_qty::float AS "maxQty", kind
         FROM v_stock_alerts WHERE $1::uuid[] IS NULL OR warehouse_id = ANY($1)
        ORDER BY kind, product_code`,
      [scope]
    ),
    query(
      `SELECT lot_id AS "lotId", lot_code AS "lotCode", to_char(expires_on, 'YYYY-MM-DD') AS "expiresOn", days_left AS "daysLeft",
              kind, quality_status AS "qualityStatus", product_id AS "productId", product_code AS "productCode",
              product_name AS "productName", unit_code AS "unitCode", quantity::float AS quantity
         FROM v_lots_expiring ORDER BY expires_on`
    )
  ]);
  return { stock, lots };
});

/** Almacenes que el usuario puede consultar (para los filtros de Existencias y Kárdex) */
export const stockWarehouses = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  return query(
    `SELECT id, code, name FROM warehouses WHERE is_active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY order_list, code`,
    [scope]
  );
});
