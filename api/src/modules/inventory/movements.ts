/**
 * @project FabriHub - API
 * @file src/modules/inventory/movements.ts
 * @description Movimientos de inventario manuales (INV_MOVEMENTS) — tesis: Movimientos y Detalles
 *
 * @overview
 * Alta en UNA transacción: correlativo → cabecera en borrador → lotes nuevos → líneas →
 * fn_post_inventory_movement() (valida y mueve existencias y costos en la BD). Si cualquier
 * regla falla, no queda nada a medias. Los contabilizados no se editan: se reversan.
 *
 * Aquí solo se usan conceptos del módulo INVENTORY; las recepciones, despachos y consumos de
 * producción los generan sus propios documentos (fases 4 a 6).
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { assertInScope, warehouseScope } from "./scope.js";

// ------------------------------------------------------------------ Consultas

const HEADER = `SELECT m.id, m.number, to_char(m.movement_date, 'YYYY-MM-DD') AS "movementDate", m.direction, m.status,
  m.concept_id AS "conceptId", c.code AS "conceptCode", c.name AS "conceptName",
  m.warehouse_id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
  m.target_warehouse_id AS "targetWarehouseId", tw.code AS "targetWarehouseCode", tw.name AS "targetWarehouseName",
  m.reference, m.notes, m.source_module AS "sourceModule", m.lines, m.total_cost::float AS "totalCost",
  m.posted_at AS "postedAt", u.names AS "createdBy",
  m.reversal_of_id AS "reversalOfId", ro.number AS "reversalOfNumber",
  m.reversed_by_id AS "reversedById", rb.number AS "reversedByNumber"
  FROM inventory_movements m
  JOIN catalogs_movement_concepts c ON c.id = m.concept_id
  JOIN warehouses w ON w.id = m.warehouse_id
  LEFT JOIN warehouses tw ON tw.id = m.target_warehouse_id
  LEFT JOIN users u ON u.id = m.created_by
  LEFT JOIN inventory_movements ro ON ro.id = m.reversal_of_id
  LEFT JOIN inventory_movements rb ON rb.id = m.reversed_by_id`;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  conceptId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  status: z.enum(["posted", "reversed"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listMovements = handler({ query: listQuery }, async ({ query: q, req }) => {
  const scope = await warehouseScope(req);
  const rows = await query(
    `${HEADER.replace("SELECT m.id,", "SELECT COUNT(*) OVER()::int AS total, m.id,")}
      WHERE m.status <> 'draft'
        AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1) OR m.target_warehouse_id = ANY($1))
        AND ($2::text IS NULL OR m.number ILIKE '%' || $2 || '%' OR m.reference ILIKE '%' || $2 || '%')
        AND ($3::uuid IS NULL OR m.concept_id = $3)
        AND ($4::uuid IS NULL OR m.warehouse_id = $4 OR m.target_warehouse_id = $4)
        AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM inventory_movements_details d WHERE d.movement_id = m.id AND d.product_id = $5))
        AND ($6::text IS NULL OR m.status = $6)
        AND ($7::date IS NULL OR m.movement_date >= $7)
        AND ($8::date IS NULL OR m.movement_date <= $8)
      ORDER BY m.posted_at DESC, m.number DESC
      LIMIT $9 OFFSET $10`,
    [scope, q.search || null, q.conceptId ?? null, q.warehouseId ?? null, q.productId ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total as number | undefined) ?? 0;
  return { items: rows.map(({ total: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

async function movementDetail(id: string, scope: string[] | null, db?: pg.PoolClient) {
  const header = await one<{ warehouseId: string; targetWarehouseId: string | null }>(`${HEADER} WHERE m.id = $1`, [id], db);
  if (!header) throw notFound("Movimiento no encontrado");
  if (scope && !scope.includes(header.warehouseId) && !(header.targetWarehouseId && scope.includes(header.targetWarehouseId))) {
    throw notFound("Movimiento no encontrado");
  }
  const lines = await query(
    `SELECT d.line_no AS "lineNo", d.product_id AS "productId", p.code AS "productCode", p.name AS "productName",
            u.code AS "unitCode", d.lot_id AS "lotId", l.lot_code AS "lotCode", to_char(l.expires_on, 'YYYY-MM-DD') AS "expiresOn",
            d.quantity::float AS quantity, d.unit_cost::float AS "unitCost", d.total_cost::float AS "totalCost",
            d.avg_cost_after::float AS "avgCostAfter", d.balance_after::float AS "balanceAfter",
            d.target_avg_cost_after::float AS "targetAvgCostAfter", d.target_balance_after::float AS "targetBalanceAfter",
            d.notes
       FROM inventory_movements_details d
       JOIN products p ON p.id = d.product_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN lots l ON l.id = d.lot_id
      WHERE d.movement_id = $1 ORDER BY d.line_no`,
    [id],
    db
  );
  return { ...header, lines };
}

export const getMovement = handler({ params: idParams }, async ({ params, req }) =>
  movementDetail(params.id, await warehouseScope(req))
);

/** Conceptos manuales y almacenes del alcance del usuario, para el formulario */
export const movementFormOptions = handler({}, async ({ req }) => {
  const scope = await warehouseScope(req);
  const [concepts, warehouses] = await Promise.all([
    query(
      `SELECT c.id, c.code, c.name, c.description, t.direction, c.lot_status_on_entry AS "lotStatusOnEntry",
              c.allows_unapproved_lots AS "allowsUnapprovedLots"
         FROM catalogs_movement_concepts c JOIN catalogs_movement_types t ON t.id = c.movement_type_id
        WHERE c.is_active AND t.is_active AND c.module_code = 'INVENTORY'
        ORDER BY c.order_list`
    ),
    query(
      `SELECT id, code, name, kind FROM warehouses
        WHERE is_active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY order_list, code`,
      [scope]
    )
  ]);
  return { concepts, warehouses };
});

// ------------------------------------------------------------------ Alta

const lineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().positive().max(1e12),
    unitCost: z.number().min(0).max(1e12).nullish(),
    lotId: z.uuid().nullish(),
    newLot: z
      .object({
        lotCode: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._/-]{1,40}$/, "Código de lote: letras, números, . _ / - (máx. 40)"),
        expiresOn: z.iso.date().nullish(),
        manufacturedOn: z.iso.date().nullish(),
        supplierLot: z.string().trim().max(40).nullish()
      })
      .nullish(),
    notes: z.string().trim().max(400).nullish()
  })
  .refine((l) => !(l.lotId && l.newLot), "Indique un lote existente o uno nuevo, no ambos");

const createBody = z.object({
  conceptId: z.uuid(),
  movementDate: z.iso.date(),
  warehouseId: z.uuid(),
  targetWarehouseId: z.uuid().nullish(),
  reference: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(800).nullish(),
  lines: z.array(lineSchema).min(1, "Agregue al menos una línea").max(200)
});

interface ProductInfo {
  id: string;
  code: string;
  is_lot_controlled: boolean;
  shelf_life_days: number | null;
}

export const createMovement = handler({ body: createBody }, async ({ body: b, req, res }) => {
  const scope = await warehouseScope(req);
  assertInScope(scope, b.warehouseId, b.targetWarehouseId);

  const concept = await one<{ module_code: string; direction: "in" | "out" | "transfer"; lot_status_on_entry: string; is_active: boolean }>(
    `SELECT c.module_code, t.direction, c.lot_status_on_entry, c.is_active
       FROM catalogs_movement_concepts c JOIN catalogs_movement_types t ON t.id = c.movement_type_id WHERE c.id = $1`,
    [b.conceptId]
  );
  if (!concept || !concept.is_active) throw badRequest("INVALID_CONCEPT", "Concepto inexistente o inactivo");
  if (concept.module_code !== "INVENTORY") {
    throw forbidden("CONCEPT_NOT_MANUAL", "Ese concepto lo genera otro módulo (compras, ventas o producción)");
  }
  if (concept.direction === "transfer" && !b.targetWarehouseId) {
    throw badRequest("TARGET_REQUIRED", "Indique el almacén destino del traslado");
  }
  if (concept.direction !== "transfer" && b.targetWarehouseId) {
    throw badRequest("TARGET_NOT_ALLOWED", "Solo los traslados llevan almacén destino");
  }
  const isEntry = concept.direction === "in";

  const future = await one<{ f: boolean }>(`SELECT $1::date > CURRENT_DATE AS f`, [b.movementDate]);
  if (future?.f) throw badRequest("FUTURE_DATE", "La fecha del movimiento no puede ser futura");

  const productIds = [...new Set(b.lines.map((l) => l.productId))];
  const products = new Map(
    (
      await query<ProductInfo>(`SELECT id, code, is_lot_controlled, shelf_life_days FROM products WHERE id = ANY($1)`, [productIds])
    ).map((p) => [p.id, p])
  );

  b.lines.forEach((l, i) => {
    const n = i + 1;
    const p = products.get(l.productId);
    if (!p) throw badRequest("INVALID_PRODUCT", `Línea ${n}: producto inexistente`);
    if (isEntry && (l.unitCost === null || l.unitCost === undefined)) {
      throw badRequest("COST_REQUIRED", `Línea ${n}: indique el costo unitario de entrada`);
    }
    if (!isEntry && l.newLot) throw badRequest("NEW_LOT_NOT_ALLOWED", `Línea ${n}: solo las entradas crean lotes`);
    if (p.is_lot_controlled && !l.lotId && !l.newLot) {
      throw badRequest("LOT_REQUIRED", `Línea ${n}: ${p.code} se maneja por lote; indique el lote`);
    }
    if (!p.is_lot_controlled && (l.lotId || l.newLot)) {
      throw badRequest("LOT_NOT_ALLOWED", `Línea ${n}: ${p.code} no se maneja por lote`);
    }
  });

  const id = await withTx(txCtx(req), async (client) => {
    const header = await one<{ id: string }>(
      `INSERT INTO inventory_movements (number, movement_date, concept_id, direction, warehouse_id, target_warehouse_id,
                                        reference, notes, source_module, created_by)
       VALUES (fn_next_document_number('MOV'), $1, $2, $3, $4, $5, $6, $7, 'INVENTORY', fn_current_app_user())
       RETURNING id`,
      [b.movementDate, b.conceptId, concept.direction, b.warehouseId, b.targetWarehouseId ?? null, b.reference ?? null, b.notes ?? null],
      client
    );
    const movementId = header!.id;

    for (const [i, l] of b.lines.entries()) {
      let lotId = l.lotId ?? null;
      const p = products.get(l.productId)!;
      if (l.newLot) {
        const exists = await one(`SELECT 1 FROM lots WHERE product_id = $1 AND lot_code = $2`, [l.productId, l.newLot.lotCode], client);
        if (exists) {
          throw conflict("LOT_EXISTS", `Línea ${i + 1}: el lote ${l.newLot.lotCode} de ${p.code} ya existe; selecciónelo`);
        }
        // Sin vencimiento explícito, se sugiere desde la vida útil del producto.
        const lot = await one<{ id: string }>(
          `INSERT INTO lots (product_id, lot_code, manufactured_on, expires_on, received_on, supplier_lot,
                             quality_status, unit_cost, origin_movement_id, created_by, updated_by)
           VALUES ($1, $2, $3,
                   COALESCE($4::date, CASE WHEN $5::int IS NOT NULL THEN COALESCE($3::date, $6::date) + $5::int END),
                   $6, $7, $8, $9, $10, fn_current_app_user(), fn_current_app_user())
           RETURNING id`,
          [
            l.productId,
            l.newLot.lotCode,
            l.newLot.manufacturedOn ?? null,
            l.newLot.expiresOn ?? null,
            p.shelf_life_days,
            b.movementDate,
            l.newLot.supplierLot ?? null,
            concept.lot_status_on_entry,
            l.unitCost ?? null,
            movementId
          ],
          client
        );
        lotId = lot!.id;
      }
      await client.query(
        `INSERT INTO inventory_movements_details (movement_id, line_no, product_id, lot_id, quantity, unit_cost, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [movementId, i + 1, l.productId, lotId, l.quantity, isEntry ? l.unitCost : null, l.notes ?? null]
      );
    }

    // Contabilización en la BD: existencias, costo promedio, lotes, vencimientos, retenidos.
    await client.query(`SELECT fn_post_inventory_movement($1)`, [movementId]);
    return movementId;
  });

  res.status(201);
  return movementDetail(id, scope);
});

// ------------------------------------------------------------------ Reverso

export const reverseMovement = handler({ params: idParams }, async ({ params, req, res }) => {
  const scope = await warehouseScope(req);
  const m = await one<{ source_module: string; warehouse_id: string; target_warehouse_id: string | null }>(
    `SELECT source_module, warehouse_id, target_warehouse_id FROM inventory_movements WHERE id = $1`,
    [params.id]
  );
  if (!m) throw notFound("Movimiento no encontrado");
  assertInScope(scope, m.warehouse_id, m.target_warehouse_id);
  if (m.source_module !== "INVENTORY") {
    throw forbidden("REVERSE_FROM_SOURCE", "Este movimiento lo generó otro módulo: se anula desde su documento de origen");
  }
  const newId = await withTx(txCtx(req), async (client) => {
    const row = await one<{ id: string }>(`SELECT fn_reverse_inventory_movement($1) AS id`, [params.id], client);
    return row!.id;
  });
  res.status(201);
  return movementDetail(newId, scope);
});
