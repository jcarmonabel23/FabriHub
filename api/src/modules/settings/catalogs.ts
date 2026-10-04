/**
 * @project FabriHub - API
 * @file src/modules/settings/catalogs.ts
 * @description CRUD genérico de catálogos comerciales (SET_COMMERCIAL) + tasas de cambio
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { CATALOGS, columnMap, createSchema, selectColumns, updateSchema, type CatalogDef } from "./catalogEngine.js";

const keyParams = z.object({ key: z.enum(Object.keys(CATALOGS) as [string, ...string[]]) });
const itemParams = keyParams.extend({ id: z.uuid() });

const defOf = (key: string): CatalogDef => CATALOGS[key];

/** Moneda base de la compañía: no se desactiva, no se borra y no lleva tasas */
const baseCurrencyId = async (): Promise<string | null> =>
  (await one<{ id: string }>(`SELECT base_currency_id AS id FROM company WHERE id = 1`))?.id ?? null;

async function isSystemRow(def: CatalogDef, id: string): Promise<boolean> {
  return Boolean((await one<{ s: boolean }>(`SELECT is_system AS s FROM ${def.table} WHERE id = $1`, [id]))?.s);
}

/** En registros de sistema, los campos de `systemLocked` no cambian (el código depende de ellos) */
async function assertSystemEditable(def: CatalogDef, id: string, body: Record<string, unknown>): Promise<void> {
  if (!def.systemLocked) return;
  const touched = def.systemLocked.filter((k) => body[k] !== undefined);
  if (touched.length === 0 || !(await isSystemRow(def, id))) return;
  const map = columnMap(def);
  const current = await one<Record<string, unknown>>(
    `SELECT ${touched.map((k) => `${map[k]} AS "${k}"`).join(", ")} FROM ${def.table} WHERE id = $1`,
    [id]
  );
  const changed = touched.filter((k) => String(current?.[k]) !== String(body[k]));
  if (changed.length) {
    throw conflict("SYSTEM_RECORD", `Registro del sistema: no se puede cambiar ${changed.join(", ")}`);
  }
}

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  active: z.enum(["true", "false"]).optional()
});

export const listCatalog = handler({ params: keyParams, query: listQuery }, async ({ params, query: q }) => {
  const def = defOf(params.key);
  return query(
    `SELECT ${selectColumns(def)} FROM ${def.table}
      WHERE ($1::text IS NULL OR code ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')
        AND ($2::boolean IS NULL OR is_active = $2)
      ORDER BY order_list, name`,
    [q.search || null, q.active === undefined ? null : q.active === "true"]
  );
});

export const catalogsMeta = handler({}, async () =>
  Object.values(CATALOGS).map((d) => ({ key: d.key, label: d.label, module: d.module, fields: d.extra.map((f) => f.key) }))
);

export const createCatalogItem = handler({ params: keyParams }, async ({ params, req, res }) => {
  const def = defOf(params.key);
  const body = createSchema(def).parse(req.body ?? {}) as Record<string, unknown>;
  const map = columnMap(def);
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  const cols = keys.map((k) => map[k]);
  const values = keys.map((k) => body[k]);

  const row = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `INSERT INTO ${def.table} (${cols.join(", ")}, created_by, updated_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, fn_current_app_user(), fn_current_app_user())
       RETURNING id`,
      values,
      client
    )
  );
  res.status(201);
  return one(`SELECT ${selectColumns(def)} FROM ${def.table} WHERE id = $1`, [row!.id]);
});

export const updateCatalogItem = handler({ params: itemParams }, async ({ params, req }) => {
  const def = defOf(params.key);
  const body = updateSchema(def).parse(req.body ?? {}) as Record<string, unknown>;

  if (def.key === "currencies" && body.isActive === false && params.id === (await baseCurrencyId())) {
    throw conflict("BASE_CURRENCY", "No se puede desactivar la moneda base de la empresa");
  }
  await assertSystemEditable(def, params.id, body);

  const map = columnMap(def);
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  const sets = keys.map((k, i) => `${map[k]} = $${i + 2}`);

  const updated = await withTx(txCtx(req), (client) =>
    one(
      `UPDATE ${def.table} SET ${[...sets, "updated_by = fn_current_app_user()"].join(", ")}
        WHERE id = $1 RETURNING id`,
      [params.id, ...keys.map((k) => body[k])],
      client
    )
  );
  if (!updated) throw notFound();
  return one(`SELECT ${selectColumns(def)} FROM ${def.table} WHERE id = $1`, [params.id]);
});

export const deleteCatalogItem = handler({ params: itemParams }, async ({ params, req }) => {
  const def = defOf(params.key);
  if (def.key === "currencies" && params.id === (await baseCurrencyId())) {
    throw conflict("BASE_CURRENCY", "No se puede eliminar la moneda base de la empresa");
  }
  if (def.systemLocked && (await isSystemRow(def, params.id))) {
    throw conflict("SYSTEM_RECORD", "Es un registro del sistema (lo usan otros módulos): puede desactivarlo, no eliminarlo");
  }
  // Si otro registro lo referencia, la FK lanza 23503 → 409 IN_USE (ver index.ts).
  const deleted = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM ${def.table} WHERE id = $1 RETURNING id`, [params.id], client)
  );
  if (!deleted) throw notFound();
  return undefined;
});

// ------------------------------------------------------------------ Tasas de cambio

const currencyParams = z.object({ id: z.uuid() });

export const listRates = handler(
  { params: currencyParams, query: z.object({ limit: z.coerce.number().int().min(1).max(365).default(60) }) },
  ({ params, query: q }) =>
    query(
      `SELECT r.id, r.rate_date AS "rateDate", r.rate::float AS rate, r.source, r.created_at AS "createdAt",
              u.names AS "createdBy"
         FROM currencies_rates r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.currency_id = $1
        ORDER BY r.rate_date DESC LIMIT $2`,
      [params.id, q.limit]
    )
);

const rateBody = z.object({
  rateDate: z.iso.date(),
  rate: z.number().positive().max(1e12),
  source: z.string().trim().max(60).optional()
});

/** Registra (o corrige) la tasa de un día: una tasa por moneda y fecha */
export const upsertRate = handler({ params: currencyParams, body: rateBody }, async ({ params, body, req }) => {
  if (params.id === (await baseCurrencyId())) {
    throw badRequest("BASE_CURRENCY", "La moneda base no lleva tasa: siempre vale 1");
  }
  if (!(await one(`SELECT 1 FROM catalogs_currencies WHERE id = $1`, [params.id]))) throw notFound("Moneda no encontrada");
  // "Hoy" según la BD (zona de la empresa), no según el reloj UTC del contenedor.
  const future = await one<{ f: boolean }>(`SELECT $1::date > CURRENT_DATE AS f`, [body.rateDate]);
  if (future?.f) throw badRequest("FUTURE_RATE", "No se registran tasas de fechas futuras");

  await withTx(txCtx(req), (client) =>
    client.query(
      `INSERT INTO currencies_rates (currency_id, rate_date, rate, source, created_by)
       VALUES ($1, $2, $3, $4, fn_current_app_user())
       ON CONFLICT (currency_id, rate_date) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source`,
      [params.id, body.rateDate, body.rate, body.source ?? null]
    )
  );
  return undefined;
});

export const deleteRate = handler({ params: z.object({ rateId: z.uuid() }) }, async ({ params, req }) => {
  const deleted = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM currencies_rates WHERE id = $1 RETURNING id`, [params.rateId], client)
  );
  if (!deleted) throw notFound();
  return undefined;
});
