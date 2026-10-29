/**
 * @project FabriHub - API
 * @file src/db.ts
 * @description Pool de PostgreSQL y helper transaccional con contexto de auditoría
 *
 * @overview
 * Toda escritura de negocio pasa por `withTx(ctx, fn)`: abre la transacción y fija
 * `app.user_id` y `app.trace_id` con set_config(..., true) (alcance de transacción).
 * El trigger `fn_audit()` los lee para saber QUIÉN hizo el cambio y en QUÉ petición.
 *
 * Multiempresa: las tablas de negocio están aisladas por RLS según `app.company_id`.
 * La empresa activa viaja en un AsyncLocalStorage (`runInCompany`, lo abre authenticate);
 * `query()` sobre el pool y `withTx()` la fijan en la conexión antes de consultar.
 * Sin empresa, RLS no devuelve ni acepta filas de negocio.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";

/**
 * Las columnas DATE viajan como texto 'YYYY-MM-DD'. Por defecto `pg` las convierte en un Date a
 * medianoche de la zona del servidor; al serializarlo a JSON (UTC) y pintarlo en otra zona horaria
 * el día se corre (03/10 se mostraba 02/10). Una fecha de calendario no tiene hora ni zona.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  application_name: "fabrihub-api"
});

pool.on("error", (err) => logger.error({ err }, "[db] error en cliente inactivo del pool"));

export type Db = pg.Pool | pg.PoolClient;

/** Contexto de auditoría que viaja a la BD */
export interface TxContext {
  userId?: string | null;
  traceId?: string | null;
  /** Empresa activa; si falta, la del runInCompany en curso */
  companyId?: string | null;
}

const companyScope = new AsyncLocalStorage<{ companyId: string }>();

/**
 * @function runInCompany
 * @description Ejecuta `fn` (y todo lo asíncrono que dispare) con `companyId` como empresa activa
 */
export function runInCompany<T>(companyId: string, fn: () => T): T {
  return companyScope.run({ companyId }, fn);
}

/** Empresa activa del contexto en curso, o null */
export const currentCompanyId = (): string | null => companyScope.getStore()?.companyId ?? null;

/**
 * @function query
 * @description Consulta parametrizada fuera de transacción (lecturas)
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool
): Promise<T[]> {
  const companyId = currentCompanyId();
  if (db !== pool || !companyId) {
    const result = await db.query<T>(text, params);
    return result.rows;
  }

  // Conexión del pool con la empresa fijada solo durante esta consulta
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("SELECT set_config('app.company_id', $1, false)", [companyId]);
    const result = await client.query<T>(text, params);
    return result.rows;
  } finally {
    try {
      await client.query("SELECT set_config('app.company_id', '', false)");
    } catch {
      broken = true; // sin limpiar, la conexión se descarta: nunca vuelve al pool con otra empresa
    }
    client.release(broken);
  }
}

/**
 * @function one
 * @description Devuelve la primera fila o null
 */
export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool
): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

/**
 * @function withTx
 * @description Ejecuta `fn` en una transacción con app.user_id / app.trace_id / app.company_id fijados
 */
export async function withTx<T>(ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.trace_id', $2, true), set_config('app.company_id', $3, true)",
      [ctx.userId ?? "", ctx.traceId ?? "", ctx.companyId ?? currentCompanyId() ?? ""]
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
