/**
 * @project FabriHub - API
 * @file src/modules/production/masters.ts
 * @description Maestros de Producción: centros de producción y de trabajo (PRD_CENTERS), rutas (PRD_ROUTES)
 *              y fórmulas con explosión/implosión (PRD_FORMULAS) — tesis 4.2.2.1.2
 *
 * @overview
 * Las etapas y los tipos de centro de trabajo son catálogos simples (motor genérico de settings).
 * Aquí viven los maestros con estructura propia:
 *  - Centro de producción: etapas que ejecuta y almacenes sugeridos de materiales y de salida.
 *  - Centro de trabajo: capacidad, eficiencia y tarifas por hora (mano de obra y costo fabril).
 *  - Ruta: secuencia de etapas con tiempos teóricos de preparación (fija) y ejecución (por cantidad base).
 *  - Fórmula: N componentes con merma y marca de crítico, una ruta, versión y "por defecto".
 * La explosión (Load Explosión) y la implosión (Load Implosión) se calculan en la BD
 * (fn_bom_explode / fn_bom_implode, multinivel y a prueba de ciclos).
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const code20 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)");
const name = z.string().trim().min(2).max(120);
const description = z.string().trim().max(400).nullish();

/** Costo estándar de un producto: el fijado, si no el promedio de todos los almacenes, si no el de compra */
export const stdCostSql = (p: string) =>
  `COALESCE(${p}.standard_cost,
            (SELECT CASE WHEN SUM(v.quantity) > 0 THEN SUM(v.total_value) / SUM(v.quantity) END FROM stock_valuation v WHERE v.product_id = ${p}.id),
            ${p}.purchase_price / ${p}.purchase_factor, 0)`;

// ================================================================== Centros de producción

const CENTER = `SELECT c.id, c.code, c.name, c.description, c.is_active AS "isActive", c.order_list AS "orderList",
  c.materials_warehouse_id AS "materialsWarehouseId", mw.code AS "materialsWarehouseCode",
  c.output_warehouse_id AS "outputWarehouseId", ow.code AS "outputWarehouseCode",
  COALESCE((SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'name', s.name) ORDER BY s.order_list)
              FROM production_centers_stages cs JOIN stages s ON s.id = cs.stage_id WHERE cs.production_center_id = c.id), '[]') AS stages,
  (SELECT COUNT(*) FROM work_centers wc WHERE wc.production_center_id = c.id)::int AS "workCenters"
  FROM production_centers c
  LEFT JOIN warehouses mw ON mw.id = c.materials_warehouse_id
  LEFT JOIN warehouses ow ON ow.id = c.output_warehouse_id`;

export const listCenters = handler({}, () => query(`${CENTER} ORDER BY c.order_list, c.code`));

const centerFields = {
  name,
  description,
  materialsWarehouseId: z.uuid().nullish(),
  outputWarehouseId: z.uuid().nullish(),
  isActive: z.boolean().default(true),
  stageIds: z.array(z.uuid()).max(100).default([])
};

async function setCenterStages(client: pg.PoolClient, id: string, stageIds: string[]) {
  await client.query(`DELETE FROM production_centers_stages WHERE production_center_id = $1`, [id]);
  if (stageIds.length) {
    await client.query(
      `INSERT INTO production_centers_stages (production_center_id, stage_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [id, stageIds]
    );
  }
}

export const createCenter = handler({ body: z.object({ code: code20, ...centerFields }) }, async ({ body: b, req, res }) => {
  const id = await withTx(txCtx(req), async (client) => {
    const row = await one<{ id: string }>(
      `INSERT INTO production_centers (code, name, description, materials_warehouse_id, output_warehouse_id, is_active, order_list, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM production_centers), fn_current_app_user(), fn_current_app_user())
       RETURNING id`,
      [b.code, b.name, b.description ?? null, b.materialsWarehouseId ?? null, b.outputWarehouseId ?? null, b.isActive],
      client
    );
    await setCenterStages(client, row!.id, b.stageIds);
    return row!.id;
  });
  res.status(201);
  return one(`${CENTER} WHERE c.id = $1`, [id]);
});

export const updateCenter = handler({ params: idParams, body: z.object(centerFields) }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    const row = await one(
      `UPDATE production_centers SET name = $2, description = $3, materials_warehouse_id = $4, output_warehouse_id = $5,
              is_active = $6, updated_by = fn_current_app_user()
        WHERE id = $1 RETURNING id`,
      [params.id, b.name, b.description ?? null, b.materialsWarehouseId ?? null, b.outputWarehouseId ?? null, b.isActive],
      client
    );
    if (!row) throw notFound("Centro de producción no encontrado");
    await setCenterStages(client, params.id, b.stageIds);
  });
  return one(`${CENTER} WHERE c.id = $1`, [params.id]);
});

export const deleteCenter = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM production_centers WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Centro de producción no encontrado");
  return undefined;
});

// ================================================================== Centros de trabajo

const WORK_CENTER = `SELECT wc.id, wc.code, wc.name, wc.description, wc.is_active AS "isActive",
  wc.work_center_type_id AS "workCenterTypeId", t.code AS "typeCode", t.name AS "typeName",
  wc.production_center_id AS "productionCenterId", pc.code AS "productionCenterCode", pc.name AS "productionCenterName",
  wc.capacity_hours_day::float AS "capacityHoursDay", wc.efficiency_pct::float AS "efficiencyPct",
  wc.labor_rate::float AS "laborRate", wc.overhead_rate::float AS "overheadRate"
  FROM work_centers wc
  JOIN catalogs_work_center_types t ON t.id = wc.work_center_type_id
  JOIN production_centers pc ON pc.id = wc.production_center_id`;

export const listWorkCenters = handler(
  { query: z.object({ productionCenterId: z.uuid().optional() }) },
  ({ query: q }) => query(`${WORK_CENTER} WHERE ($1::uuid IS NULL OR wc.production_center_id = $1) ORDER BY pc.order_list, wc.order_list, wc.code`, [q.productionCenterId ?? null])
);

const workCenterFields = {
  name,
  description,
  workCenterTypeId: z.uuid(),
  productionCenterId: z.uuid(),
  capacityHoursDay: z.number().positive().max(24),
  efficiencyPct: z.number().positive().max(200),
  laborRate: z.number().min(0).max(1e9),
  overheadRate: z.number().min(0).max(1e9),
  isActive: z.boolean().default(true)
};

export const createWorkCenter = handler({ body: z.object({ code: code20, ...workCenterFields }) }, async ({ body: b, req, res }) => {
  const row = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `INSERT INTO work_centers (code, name, description, work_center_type_id, production_center_id, capacity_hours_day, efficiency_pct,
                                 labor_rate, overhead_rate, is_active, order_list, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM work_centers),
               fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [b.code, b.name, b.description ?? null, b.workCenterTypeId, b.productionCenterId, b.capacityHoursDay, b.efficiencyPct, b.laborRate, b.overheadRate, b.isActive],
      client
    )
  );
  res.status(201);
  return one(`${WORK_CENTER} WHERE wc.id = $1`, [row!.id]);
});

export const updateWorkCenter = handler({ params: idParams, body: z.object(workCenterFields) }, async ({ params, body: b, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(
      `UPDATE work_centers SET name = $2, description = $3, work_center_type_id = $4, production_center_id = $5, capacity_hours_day = $6,
              efficiency_pct = $7, labor_rate = $8, overhead_rate = $9, is_active = $10, updated_by = fn_current_app_user()
        WHERE id = $1 RETURNING id`,
      [params.id, b.name, b.description ?? null, b.workCenterTypeId, b.productionCenterId, b.capacityHoursDay, b.efficiencyPct, b.laborRate, b.overheadRate, b.isActive],
      client
    )
  );
  if (!row) throw notFound("Centro de trabajo no encontrado");
  return one(`${WORK_CENTER} WHERE wc.id = $1`, [params.id]);
});

export const deleteWorkCenter = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM work_centers WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Centro de trabajo no encontrado");
  return undefined;
});

// ================================================================== Rutas

const ROUTE = `SELECT r.id, r.code, r.name, r.description, r.is_active AS "isActive", r.base_quantity::float AS "baseQuantity",
  r.production_center_id AS "productionCenterId", pc.code AS "productionCenterCode",
  (SELECT COUNT(*) FROM routes_data d WHERE d.route_id = r.id)::int AS steps,
  COALESCE((SELECT SUM(d.setup_hours + d.run_hours) FROM routes_data d WHERE d.route_id = r.id), 0)::float AS "baseHours",
  (SELECT COUNT(*) FROM formulas f WHERE f.route_id = r.id)::int AS formulas,
  r.updated_at AS "updatedAt"
  FROM routes r LEFT JOIN production_centers pc ON pc.id = r.production_center_id`;

export const listRoutes = handler({ query: z.object({ search: z.string().trim().max(60).optional() }) }, ({ query: q }) =>
  query(`${ROUTE} WHERE ($1::text IS NULL OR r.code ILIKE '%' || $1 || '%' OR r.name ILIKE '%' || $1 || '%') ORDER BY r.code`, [q.search || null])
);

async function routeDetail(id: string) {
  const r = await one(`${ROUTE} WHERE r.id = $1`, [id]);
  if (!r) throw notFound("Ruta no encontrada");
  const steps = await query(
    `SELECT d.id, d.sequence, d.stage_id AS "stageId", s.code AS "stageCode", s.name AS "stageName",
            d.work_center_id AS "workCenterId", wc.code AS "workCenterCode", wc.name AS "workCenterName",
            d.setup_hours::float AS "setupHours", d.run_hours::float AS "runHours", d.notes,
            wc.labor_rate::float AS "laborRate", wc.overhead_rate::float AS "overheadRate"
       FROM routes_data d JOIN stages s ON s.id = d.stage_id JOIN work_centers wc ON wc.id = d.work_center_id
      WHERE d.route_id = $1 ORDER BY d.sequence`,
    [id]
  );
  return { ...r, steps };
}

export const getRoute = handler({ params: idParams }, ({ params }) => routeDetail(params.id));

const routeBody = z.object({
  name,
  description,
  productionCenterId: z.uuid().nullish(),
  baseQuantity: z.number().positive().max(1e12),
  isActive: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        sequence: z.number().int().min(1).max(9999),
        stageId: z.uuid(),
        workCenterId: z.uuid(),
        setupHours: z.number().min(0).max(10000),
        runHours: z.number().min(0).max(10000),
        notes: z.string().trim().max(400).nullish()
      })
    )
    .min(1, "La ruta necesita al menos una etapa")
    .max(100)
    .refine((s) => new Set(s.map((x) => x.sequence)).size === s.length, "Hay secuencias repetidas")
});

async function saveRouteSteps(client: pg.PoolClient, id: string, b: z.infer<typeof routeBody>) {
  if (b.productionCenterId) {
    const foreign = await one<{ code: string }>(
      `SELECT wc.code FROM work_centers wc WHERE wc.id = ANY($1) AND wc.production_center_id <> $2 LIMIT 1`,
      [b.steps.map((s) => s.workCenterId), b.productionCenterId],
      client
    );
    if (foreign) throw badRequest("WORK_CENTER_OUTSIDE", `El centro de trabajo ${foreign.code} no pertenece al centro de producción de la ruta`);
  }
  await client.query(`DELETE FROM routes_data WHERE route_id = $1`, [id]);
  for (const s of b.steps) {
    await client.query(
      `INSERT INTO routes_data (route_id, sequence, stage_id, work_center_id, setup_hours, run_hours, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, s.sequence, s.stageId, s.workCenterId, s.setupHours, s.runHours, s.notes ?? null]
    );
  }
}

export const createRoute = handler({ body: routeBody.extend({ code: code20 }) }, async ({ body: b, req, res }) => {
  const id = await withTx(txCtx(req), async (client) => {
    const row = await one<{ id: string }>(
      `INSERT INTO routes (code, name, description, production_center_id, base_quantity, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [b.code, b.name, b.description ?? null, b.productionCenterId ?? null, b.baseQuantity, b.isActive],
      client
    );
    await saveRouteSteps(client, row!.id, b);
    return row!.id;
  });
  res.status(201);
  return routeDetail(id);
});

export const updateRoute = handler({ params: idParams, body: routeBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    const row = await one(
      `UPDATE routes SET name = $2, description = $3, production_center_id = $4, base_quantity = $5, is_active = $6,
              updated_by = fn_current_app_user() WHERE id = $1 RETURNING id`,
      [params.id, b.name, b.description ?? null, b.productionCenterId ?? null, b.baseQuantity, b.isActive],
      client
    );
    if (!row) throw notFound("Ruta no encontrada");
    await saveRouteSteps(client, params.id, b);
  });
  return routeDetail(params.id);
});

export const deleteRoute = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) => one(`DELETE FROM routes WHERE id = $1 RETURNING id`, [params.id], client));
  if (!row) throw notFound("Ruta no encontrada");
  return undefined;
});

// ================================================================== Fórmulas

const FORMULA = `SELECT f.id, f.code, f.name, f.version, f.is_default AS "isDefault", f.is_active AS "isActive",
  f.base_quantity::float AS "baseQuantity", to_char(f.valid_from, 'YYYY-MM-DD') AS "validFrom", f.notes,
  f.product_id AS "productId", p.code AS "productCode", p.name AS "productName", u.code AS "unitCode",
  f.route_id AS "routeId", r.code AS "routeCode", r.name AS "routeName",
  (SELECT COUNT(*) FROM formulas_details d WHERE d.formula_id = f.id)::int AS components,
  (SELECT COUNT(*) FROM production_orders o WHERE o.formula_id = f.id)::int AS orders,
  f.updated_at AS "updatedAt"
  FROM formulas f
  JOIN products p ON p.id = f.product_id
  JOIN catalogs_units u ON u.id = p.stock_unit_id
  LEFT JOIN routes r ON r.id = f.route_id`;

export const listFormulas = handler(
  { query: z.object({ search: z.string().trim().max(60).optional(), productId: z.uuid().optional() }) },
  ({ query: q }) =>
    query(
      `${FORMULA} WHERE ($1::text IS NULL OR f.code ILIKE '%' || $1 || '%' OR f.name ILIKE '%' || $1 || '%'
                         OR p.code ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%')
                    AND ($2::uuid IS NULL OR f.product_id = $2)
       ORDER BY p.code, f.version DESC`,
      [q.search || null, q.productId ?? null]
    )
);

async function formulaDetail(id: string) {
  const f = await one<{ baseQuantity: number }>(`${FORMULA} WHERE f.id = $1`, [id]);
  if (!f) throw notFound("Fórmula no encontrada");
  const lines = await query<{ stdCost: number; quantity: number; scrapPct: number }>(
    `SELECT d.id, d.line_no AS "lineNo", d.component_id AS "componentId", p.code AS "componentCode", p.name AS "componentName",
            u.code AS "unitCode", d.quantity::float AS quantity, d.scrap_pct::float AS "scrapPct", d.is_critical AS "isCritical",
            d.stage_id AS "stageId", s.code AS "stageCode", d.notes, t.code AS "typeCode",
            EXISTS (SELECT 1 FROM formulas f2 WHERE f2.product_id = p.id AND f2.is_default AND f2.is_active) AS "hasFormula",
            (${stdCostSql("p")})::float AS "stdCost"
       FROM formulas_details d
       JOIN products p ON p.id = d.component_id
       JOIN catalogs_product_types t ON t.id = p.product_type_id
       JOIN catalogs_units u ON u.id = p.stock_unit_id
       LEFT JOIN stages s ON s.id = d.stage_id
      WHERE d.formula_id = $1 ORDER BY d.line_no`,
    [id]
  );
  const materialCost = lines.reduce((a, l) => a + l.quantity * (1 + l.scrapPct / 100) * l.stdCost, 0);
  return { ...f, lines, materialCost, materialUnitCost: materialCost / f.baseQuantity };
}

export const getFormula = handler({ params: idParams }, ({ params }) => formulaDetail(params.id));

const formulaBody = z.object({
  name: z.string().trim().min(2).max(160),
  baseQuantity: z.number().positive().max(1e12),
  routeId: z.uuid().nullish(),
  validFrom: z.iso.date().optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(800).nullish(),
  lines: z
    .array(
      z.object({
        componentId: z.uuid(),
        quantity: z.number().positive().max(1e12),
        scrapPct: z.number().min(0).max(99.99).default(0),
        isCritical: z.boolean().default(false),
        stageId: z.uuid().nullish(),
        notes: z.string().trim().max(400).nullish()
      })
    )
    .min(1, "La fórmula necesita al menos un componente")
    .max(200)
    .refine((l) => new Set(l.map((x) => x.componentId)).size === l.length, "Un componente aparece dos veces")
});

async function saveFormulaLines(client: pg.PoolClient, id: string, productId: string, b: z.infer<typeof formulaBody>) {
  if (b.isDefault) {
    await client.query(`UPDATE formulas SET is_default = FALSE, updated_by = fn_current_app_user() WHERE product_id = $1 AND id <> $2 AND is_default`, [
      productId,
      id
    ]);
  }
  await client.query(`DELETE FROM formulas_details WHERE formula_id = $1`, [id]);
  for (const [i, l] of b.lines.entries()) {
    await client.query(
      `INSERT INTO formulas_details (formula_id, line_no, component_id, quantity, scrap_pct, is_critical, stage_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, i + 1, l.componentId, l.quantity, l.scrapPct, l.isCritical, l.stageId ?? null, l.notes ?? null]
    );
  }
}

export const createFormula = handler(
  {
    body: formulaBody.extend({
      productId: z.uuid(),
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9._-]{1,30}$/, "Solo mayúsculas, números, punto, - y _ (máx. 30)")
    })
  },
  async ({ body: b, req, res }) => {
    const id = await withTx(txCtx(req), async (client) => {
      const p = await one<{ is_manufactured: boolean; code: string }>(`SELECT is_manufactured, code FROM products WHERE id = $1`, [b.productId], client);
      if (!p) throw badRequest("INVALID_PRODUCT", "Producto inexistente");
      if (!p.is_manufactured) throw badRequest("NOT_MANUFACTURED", `${p.code} no está marcado como fabricado`);
      const first = !(await one(`SELECT 1 FROM formulas WHERE product_id = $1 AND is_default`, [b.productId], client));
      const row = await one<{ id: string }>(
        `INSERT INTO formulas (code, name, product_id, version, is_default, base_quantity, route_id, valid_from, is_active, notes, created_by, updated_by)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(version), 0) + 1 FROM formulas WHERE product_id = $3), $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9,
                 fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [b.code, b.name, b.productId, false, b.baseQuantity, b.routeId ?? null, b.validFrom ?? null, b.isActive, b.notes ?? null],
        client
      );
      // La primera fórmula del producto queda por defecto aunque no se pida.
      const isDefault = b.isDefault || first;
      await saveFormulaLines(client, row!.id, b.productId, { ...b, isDefault });
      if (isDefault) await client.query(`UPDATE formulas SET is_default = TRUE WHERE id = $1`, [row!.id]);
      return row!.id;
    });
    res.status(201);
    return formulaDetail(id);
  }
);

export const updateFormula = handler({ params: idParams, body: formulaBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    const f = await one<{ product_id: string; is_default: boolean }>(`SELECT product_id, is_default FROM formulas WHERE id = $1 FOR UPDATE`, [params.id], client);
    if (!f) throw notFound("Fórmula no encontrada");
    if (f.is_default && !b.isDefault) throw badRequest("DEFAULT_REQUIRED", "Para quitarle el «por defecto», marque otra fórmula del producto como predeterminada");
    if (!b.isActive && (b.isDefault || f.is_default)) throw badRequest("DEFAULT_INACTIVE", "La fórmula por defecto no se puede desactivar");
    await saveFormulaLines(client, params.id, f.product_id, b);
    await client.query(
      `UPDATE formulas SET name = $2, base_quantity = $3, route_id = $4, valid_from = COALESCE($5::date, valid_from), is_default = $6,
              is_active = $7, notes = $8, updated_by = fn_current_app_user() WHERE id = $1`,
      [params.id, b.name, b.baseQuantity, b.routeId ?? null, b.validFrom ?? null, b.isDefault, b.isActive, b.notes ?? null]
    );
  });
  return formulaDetail(params.id);
});

export const deleteFormula = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const f = await one<{ is_default: boolean; others: number }>(
      `SELECT is_default, (SELECT COUNT(*) FROM formulas o WHERE o.product_id = f.product_id AND o.id <> f.id)::int AS others
         FROM formulas f WHERE id = $1`,
      [params.id],
      client
    );
    if (!f) throw notFound("Fórmula no encontrada");
    if (f.is_default && f.others > 0) throw conflict("IS_DEFAULT", "Marque otra fórmula como predeterminada antes de eliminar esta");
    await client.query(`DELETE FROM formulas WHERE id = $1`, [params.id]);
  });
  return undefined;
});

// ================================================================== Explosión e implosión

/**
 * Load Explosión + Verificar Existencia: árbol multinivel con la cantidad requerida de cada
 * componente y lo disponible (existencia no reservada en lotes aprobados y vigentes).
 */
export const explode = handler(
  { query: z.object({ productId: z.uuid(), quantity: z.coerce.number().positive().max(1e12), formulaId: z.uuid().optional() }) },
  async ({ query: q }) => {
    const rows = await query<{ quantity: number; available: number; hasFormula: boolean; isCritical: boolean; stdCost: number; level: number }>(
      `SELECT e.level, e.path, e.parent_id AS "parentId", e.component_id AS "componentId", p.code AS "componentCode", p.name AS "componentName",
              u.code AS "unitCode", t.code AS "typeCode", e.quantity::float AS quantity, e.is_critical AS "isCritical", e.has_formula AS "hasFormula",
              COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = e.component_id), 0)::float AS available,
              (${stdCostSql("p")})::float AS "stdCost"
         FROM fn_bom_explode($1, $2, $3) e
         JOIN products p ON p.id = e.component_id
         JOIN catalogs_product_types t ON t.id = p.product_type_id
         JOIN catalogs_units u ON u.id = p.stock_unit_id
        ORDER BY e.path`,
      [q.productId, q.quantity, q.formulaId ?? null]
    );
    const items = rows.map((r) => ({ ...r, shortfall: Math.max(0, Math.round((r.quantity - r.available) * 1e6) / 1e6) }));
    const level1 = items.filter((r) => r.level === 1);
    return {
      items,
      materialCost: level1.reduce((a, r) => a + r.quantity * r.stdCost, 0),
      criticalShortages: level1.filter((r) => r.isCritical && r.shortfall > 0).length,
      shortages: level1.filter((r) => r.shortfall > 0).length
    };
  }
);

/** Load Implosión: en qué fórmulas (y productos finales) se usa un componente */
export const implode = handler({ query: z.object({ productId: z.uuid() }) }, ({ query: q }) =>
  query(
    `SELECT i.level, i.path, i.product_id AS "productId", p.code AS "productCode", p.name AS "productName", pu.code AS "productUnitCode",
            i.formula_id AS "formulaId", f.code AS "formulaCode", f.version, f.is_default AS "isDefault",
            c.code AS "usedCode", cu.code AS "usedUnitCode", i.quantity::float AS quantity, i.base_quantity::float AS "baseQuantity"
       FROM fn_bom_implode($1) i
       JOIN products p ON p.id = i.product_id
       JOIN catalogs_units pu ON pu.id = p.stock_unit_id
       JOIN formulas f ON f.id = i.formula_id
       JOIN products c ON c.id = i.used_component_id
       JOIN catalogs_units cu ON cu.id = c.stock_unit_id
      ORDER BY i.path`,
    [q.productId]
  )
);
