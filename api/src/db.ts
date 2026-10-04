/**
 * @project FabriHub - API
 * @file src/db.ts
 * @description Pool de PostgreSQL y helper transaccional con contexto de auditoría
 *
 * @overview
 * Toda escritura de negocio pasa por `withTx(ctx, fn)`: abre la transacción y fija
 * `app.user_id` y `app.trace_id` con set_config(..., true) (alcance de transacción).
 * El trigger `fn_audit()` los lee para saber QUIÉN hizo el cambio y en QUÉ petición.
 */

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
}

/**
 * @function query
 * @description Consulta parametrizada fuera de transacción (lecturas)
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
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
 * @description Ejecuta `fn` en una transacción con app.user_id / app.trace_id fijados
 */
export async function withTx<T>(ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.trace_id', $2, true)", [
      ctx.userId ?? "",
      ctx.traceId ?? ""
    ]);
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
