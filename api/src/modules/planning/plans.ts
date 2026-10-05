/**
 * @project FabriHub - API
 * @file src/modules/planning/plans.ts
 * @description Planificación (PRD_PLANNING): períodos, plan de ventas y plan maestro de producción (MPS)
 *
 * @overview
 * Un período es un año. Cada producto tiene 12 cantidades por tipo de plan (tesis: Enero…Diciembre,
 * normalizado a filas en `plans`).
 *  - Plan de ventas: lo carga el planificador, o se propone desde lo despachado (promedio mensual).
 *  - Plan maestro (MPS): se GENERA desde el plan de ventas para cada mes que falta del año:
 *      disponible proyectado = disponible + OP abiertas − ventas del mes;
 *      si queda bajo el stock de seguridad (suma de mínimos), se programa producción redondeada
 *      al tamaño de lote de la fórmula (su cantidad base). El planificador puede ajustarlo a mano.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const monthOf = (d: string) => Number(d.slice(5, 7));

/** Mes desde el que se planifica: el actual si el período es este año, enero si es futuro */
export async function firstPlannableMonth(db: pg.PoolClient | undefined, year: number) {
  const now = (await one<{ y: number; m: number }>(`SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y, EXTRACT(MONTH FROM CURRENT_DATE)::int AS m`, [], db))!;
  if (year < now.y) return null;
  return year === now.y ? now.m : 1;
}

// ================================================================== Períodos

const PERIOD = `SELECT pp.id, pp.code, pp.name, pp.year, pp.status, pp.notes, pp.created_at AS "createdAt", u.names AS "createdBy",
  (SELECT COUNT(DISTINCT product_id) FROM plans p WHERE p.period_id = pp.id AND p.plan_type = 'sales')::int AS "salesProducts",
  (SELECT COALESCE(SUM(quantity), 0) FROM plans p WHERE p.period_id = pp.id AND p.plan_type = 'mps')::float AS "mpsTotal",
  (SELECT row_to_json(r) FROM (SELECT id, run_at AS "runAt", suggestions FROM mrp_runs WHERE period_id = pp.id ORDER BY run_at DESC LIMIT 1) r) AS "lastRun"
  FROM planning_periods pp LEFT JOIN users u ON u.id = pp.created_by`;

export const listPeriods = handler({}, () => query(`${PERIOD} ORDER BY pp.year DESC, pp.code`));

async function lockPeriod(client: pg.PoolClient, id: string) {
  const p = await one<{ id: string; year: number; status: string; code: string }>(`SELECT id, year, status, code FROM planning_periods WHERE id = $1 FOR UPDATE`, [id], client);
  if (!p) throw notFound("Período no encontrado");
  if (p.status !== "open") throw conflict("PERIOD_CLOSED", `El período ${p.code} está cerrado`);
  return p;
}

export const createPeriod = handler(
  {
    body: z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _"),
      name: z.string().trim().min(2).max(120),
      year: z.number().int().min(2000).max(2100),
      notes: z.string().trim().max(800).nullish(),
      copyFromId: z.uuid().nullish()
    })
  },
  async ({ body: b, req, res }) => {
    const id = await withTx(txCtx(req), async (client) => {
      const row = await one<{ id: string }>(
        `INSERT INTO planning_periods (code, name, year, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [b.code, b.name, b.year, b.notes ?? null],
        client
      );
      // Copiar el plan de ventas de otro período (p. ej. el del año anterior) como punto de partida
      if (b.copyFromId) {
        await client.query(
          `INSERT INTO plans (period_id, product_id, plan_type, month, quantity, updated_by)
           SELECT $1, product_id, 'sales', month, quantity, fn_current_app_user() FROM plans WHERE period_id = $2 AND plan_type = 'sales'`,
          [row!.id, b.copyFromId]
        );
      }
      return row!.id;
    });
    res.status(201);
    return one(`${PERIOD} WHERE pp.id = $1`, [id]);
  }
);

export const updatePeriod = handler(
  { params: idParams, body: z.object({ name: z.string().trim().min(2).max(120).optional(), status: z.enum(["open", "closed"]).optional(), notes: z.string().trim().max(800).nullish() }) },
  async ({ params, body: b, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE planning_periods SET name = COALESCE($2, name), status = COALESCE($3, status), notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
                updated_by = fn_current_app_user() WHERE id = $1 RETURNING id`,
        [params.id, b.name ?? null, b.status ?? null, b.notes !== undefined, b.notes ?? null],
        client
      )
    );
    if (!row) throw notFound("Período no encontrado");
    return one(`${PERIOD} WHERE pp.id = $1`, [params.id]);
  }
);

export const deletePeriod = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    await lockPeriod(client, params.id);
    const converted = await one(
      `SELECT 1 FROM mrp_suggestions s JOIN mrp_runs r ON r.id = s.run_id WHERE r.period_id = $1 AND s.status = 'converted' LIMIT 1`,
      [params.id],
      client
    );
    if (converted) throw conflict("HAS_DOCUMENTS", "El período ya generó órdenes desde el MRP: ciérrelo en lugar de eliminarlo");
    await client.query(`DELETE FROM planning_periods WHERE id = $1`, [params.id]);
  });
  return undefined;
});

// ================================================================== Planes

export const getPlans = handler({ params: idParams }, async ({ params }) => {
  const period = await one<{ year: number }>(`${PERIOD} WHERE pp.id = $1`, [params.id]);
  if (!period) throw notFound("Período no encontrado");
  const rows = await query<{ productId: string; type: string; month: number; quantity: number }>(
    `SELECT product_id AS "productId", plan_type AS type, month, quantity::float AS quantity FROM plans WHERE period_id = $1`,
    [params.id]
  );
  const ids = [...new Set(rows.map((r) => r.productId))];
  const products = await query<{ id: string }>(
    `SELECT p.id, p.code, p.name, u.code AS "unitCode", p.is_manufactured AS "isManufactured",
            EXISTS (SELECT 1 FROM formulas f WHERE f.product_id = p.id AND f.is_default AND f.is_active) AS "hasFormula",
            (SELECT f.base_quantity::float FROM formulas f WHERE f.product_id = p.id AND f.is_default AND f.is_active) AS "lotSize",
            COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = p.id), 0)::float AS available,
            COALESCE((SELECT SUM(sp.min_qty) FROM stock_policies sp WHERE sp.product_id = p.id), 0)::float AS "safetyStock"
       FROM products p JOIN catalogs_units u ON u.id = p.stock_unit_id WHERE p.id = ANY($1) ORDER BY p.code`,
    [ids]
  );
  const months = (pid: string, type: string) => {
    const arr = Array<number>(12).fill(0);
    for (const r of rows) if (r.productId === pid && r.type === type) arr[r.month - 1] = r.quantity;
    return arr;
  };
  return {
    period,
    firstMonth: await firstPlannableMonth(undefined, period.year),
    products: products.map((p) => ({ ...p, sales: months(p.id, "sales"), mps: months(p.id, "mps") }))
  };
});

const twelve = z.array(z.number().min(0).max(1e12)).length(12);

export const savePlans = handler(
  {
    params: idParams,
    body: z.object({
      type: z.enum(["sales", "mps"]),
      rows: z.array(z.object({ productId: z.uuid(), months: twelve })).min(1).max(500)
    })
  },
  async ({ params, body: b, req }) => {
    await withTx(txCtx(req), async (client) => {
      await lockPeriod(client, params.id);
      const products = await query<{ id: string; code: string; is_sold: boolean; is_manufactured: boolean; is_active: boolean }>(
        `SELECT id, code, is_sold, is_manufactured, is_active FROM products WHERE id = ANY($1)`,
        [b.rows.map((r) => r.productId)],
        client
      );
      for (const r of b.rows) {
        const p = products.find((x) => x.id === r.productId);
        if (!p || !p.is_active) throw badRequest("INVALID_PRODUCT", "Producto inexistente o inactivo");
        if (b.type === "sales" && !p.is_sold) throw badRequest("NOT_SOLD", `${p.code} no se vende: no va en el plan de ventas`);
        if (b.type === "mps" && !p.is_manufactured) throw badRequest("NOT_MANUFACTURED", `${p.code} no se fabrica: no va en el plan maestro`);
        await client.query(
          `INSERT INTO plans (period_id, product_id, plan_type, month, quantity, updated_by)
           SELECT $1, $2, $3, m, ($4::numeric[])[m], fn_current_app_user() FROM generate_series(1, 12) AS m
           ON CONFLICT (period_id, product_id, plan_type, month) DO UPDATE SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [params.id, r.productId, b.type, r.months]
        );
      }
    });
    return undefined;
  }
);

export const removeProduct = handler({ params: z.object({ id: z.uuid(), productId: z.uuid() }) }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    await lockPeriod(client, params.id);
    await client.query(`DELETE FROM plans WHERE period_id = $1 AND product_id = $2`, [params.id, params.productId]);
  });
  return undefined;
});

/** Propone el plan de ventas desde lo despachado: promedio mensual de los últimos N meses × (1 + crecimiento) */
export const salesFromHistory = handler(
  { params: idParams, body: z.object({ months: z.number().int().min(1).max(24).default(6), growthPct: z.number().min(-90).max(500).default(0) }) },
  async ({ params, body: b, req }) => {
    const filled = await withTx(txCtx(req), async (client) => {
      const p = await lockPeriod(client, params.id);
      const first = await firstPlannableMonth(client, p.year);
      if (!first) throw conflict("PAST_PERIOD", "El período ya pasó: no se planifica");
      const avg = await query<{ product_id: string; avg: string }>(
        `SELECT dd.product_id, SUM(dd.stock_quantity) / $1::numeric AS avg
           FROM delivery_notes_details dd JOIN delivery_notes n ON n.id = dd.delivery_note_id
          WHERE n.status = 'posted' AND n.delivery_date >= CURRENT_DATE - ($1::int || ' months')::interval
          GROUP BY dd.product_id`,
        [b.months],
        client
      );
      for (const a of avg) {
        const q = Math.ceil(Number(a.avg) * (1 + b.growthPct / 100));
        await client.query(
          `INSERT INTO plans (period_id, product_id, plan_type, month, quantity, updated_by)
           SELECT $1, $2, 'sales', m, CASE WHEN m >= $3 THEN $4 ELSE 0 END, fn_current_app_user() FROM generate_series(1, 12) AS m
           ON CONFLICT (period_id, product_id, plan_type, month) DO UPDATE SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = NOW()
           WHERE plans.month >= $3`,
          [params.id, a.product_id, first, q]
        );
      }
      return avg.length;
    });
    return { products: filled };
  }
);

// ================================================================== Plan maestro

/** Recepciones programadas de OP abiertas del producto, por mes del año del período */
async function openProductionByMonth(client: pg.PoolClient, productId: string, year: number, first: number) {
  const rows = await query<{ due: string; qty: string }>(
    `SELECT to_char(COALESCE(planned_end, planned_start), 'YYYY-MM-DD') AS due, quantity_planned - quantity_produced AS qty
       FROM production_orders WHERE product_id = $1 AND status IN ('planned', 'created', 'released', 'in_process') AND quantity_planned > quantity_produced`,
    [productId],
    client
  );
  const byMonth = new Map<number, number>();
  for (const r of rows) {
    const y = Number(r.due.slice(0, 4));
    if (y > year) continue;
    const m = y < year ? first : Math.max(first, monthOf(r.due));
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(r.qty));
  }
  return byMonth;
}

export const generateMps = handler({ params: idParams }, async ({ params, req }) => {
  const result = await withTx(txCtx(req), async (client) => {
    const p = await lockPeriod(client, params.id);
    const first = await firstPlannableMonth(client, p.year);
    if (!first) throw conflict("PAST_PERIOD", "El período ya pasó: no se planifica");
    const products = await query<{ id: string; code: string; is_manufactured: boolean; lot: string | null; available: string; safety: string }>(
      `SELECT pr.id, pr.code, pr.is_manufactured,
              (SELECT f.base_quantity FROM formulas f WHERE f.product_id = pr.id AND f.is_default AND f.is_active) AS lot,
              COALESCE((SELECT SUM(a.available) FROM v_stock_available a WHERE a.product_id = pr.id), 0) AS available,
              COALESCE((SELECT SUM(sp.min_qty) FROM stock_policies sp WHERE sp.product_id = pr.id), 0) AS safety
         FROM products pr WHERE pr.id IN (SELECT DISTINCT product_id FROM plans WHERE period_id = $1 AND plan_type = 'sales')`,
      [params.id],
      client
    );
    if (products.length === 0) throw badRequest("NO_SALES_PLAN", "Cargue primero el plan de ventas");
    const skipped: string[] = [];
    let generated = 0;
    for (const pr of products) {
      if (!pr.is_manufactured || !pr.lot) {
        skipped.push(pr.code);
        continue;
      }
      const sales = await query<{ month: number; quantity: string }>(
        `SELECT month, quantity FROM plans WHERE period_id = $1 AND product_id = $2 AND plan_type = 'sales'`,
        [params.id, pr.id],
        client
      );
      const demand = new Map(sales.map((s) => [s.month, Number(s.quantity)]));
      const receipts = await openProductionByMonth(client, pr.id, p.year, first);
      const lot = Number(pr.lot);
      const safety = Number(pr.safety);
      let poh = Number(pr.available);
      const mps = Array<number>(12).fill(0);
      for (let m = first; m <= 12; m++) {
        poh = poh + (receipts.get(m) ?? 0) - (demand.get(m) ?? 0);
        if (poh < safety) {
          const qty = Math.ceil(round6(safety - poh) / lot) * lot;
          mps[m - 1] = qty;
          poh += qty;
        }
      }
      await client.query(
        `INSERT INTO plans (period_id, product_id, plan_type, month, quantity, updated_by)
         SELECT $1, $2, 'mps', m, ($3::numeric[])[m], fn_current_app_user() FROM generate_series(1, 12) AS m
         ON CONFLICT (period_id, product_id, plan_type, month) DO UPDATE SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [params.id, pr.id, mps]
      );
      generated += 1;
    }
    return { generated, skipped, firstMonth: first };
  });
  return result;
});
