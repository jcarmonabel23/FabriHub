/**
 * @project FabriHub - API
 * @file src/modules/pos/terminals.ts
 * @description Cajas del POS (POS_TERMINALS): almacén, lista de precios, cliente por defecto y correlativo
 *
 * @overview
 * El correlativo de comprobantes es propio de cada caja (prefijo único en la empresa). Una caja
 * con ventas no se elimina: se desactiva. Tampoco cambia de almacén con un turno abierto.
 */

import { z } from "zod";
import type pg from "pg";
import { one, query, withTx, type Db } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const terminalBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Código: letras, números, guion o guion bajo (máx. 20)"),
  name: z.string().trim().min(2).max(80),
  warehouseId: z.uuid(),
  priceListId: z.uuid().nullish(),
  defaultCustomerId: z.uuid().nullish(),
  ticketPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{0,10}$/, "Prefijo: letras, números o guion (máx. 10)")
    .optional(),
  ticketPadding: z.number().int().min(4).max(12).default(8),
  notes: z.string().trim().max(400).nullish(),
  isActive: z.boolean().default(true)
});

const SELECT = `SELECT t.id, t.code, t.name, t.is_active AS "isActive", t.warehouse_id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
       t.price_list_id AS "priceListId", pl.code AS "priceListCode", pl.name AS "priceListName",
       t.default_customer_id AS "defaultCustomerId", c.legal_name AS "defaultCustomerName",
       t.ticket_prefix AS "ticketPrefix", t.ticket_padding AS "ticketPadding", t.next_ticket::int AS "nextTicket", t.notes,
       s.id AS "openSessionId", s.number AS "openSessionNumber", cu.names AS "openSessionCashier",
       t.updated_at AS "updatedAt"
  FROM pos_terminals t
  JOIN warehouses w ON w.id = t.warehouse_id
  LEFT JOIN price_lists pl ON pl.id = t.price_list_id
  LEFT JOIN customers c ON c.id = t.default_customer_id
  LEFT JOIN pos_sessions s ON s.terminal_id = t.id AND s.status = 'open'
  LEFT JOIN users cu ON cu.id = s.cashier_id`;

export function terminalDetail(id: string, db?: Db) {
  return one(`${SELECT} WHERE t.id = $1`, [id], db);
}

export const listTerminals = handler({ query: z.object({ active: z.enum(["true", "false"]).optional() }) }, async ({ query: q }) =>
  query(`${SELECT} WHERE ($1::boolean IS NULL OR t.is_active = $1) ORDER BY t.code`, [q.active === undefined ? null : q.active === "true"])
);

export const getTerminal = handler({ params: idParams }, async ({ params }) => {
  const t = await terminalDetail(params.id);
  if (!t) throw notFound("Caja no encontrada");
  return t;
});

/** Referencias válidas: almacén activo, lista de VENTA activa, cliente activo */
async function assertRefs(client: pg.PoolClient, b: z.infer<typeof terminalBody>) {
  const w = await one<{ is_active: boolean }>(`SELECT is_active FROM warehouses WHERE id = $1`, [b.warehouseId], client);
  if (!w?.is_active) throw badRequest("INVALID_WAREHOUSE", "Almacén inexistente o inactivo");
  if (b.priceListId) {
    const pl = await one<{ ok: boolean }>(`SELECT (is_active AND scope = 'sales') AS ok FROM price_lists WHERE id = $1`, [b.priceListId], client);
    if (!pl?.ok) throw badRequest("INVALID_PRICE_LIST", "La lista de precios no existe, está inactiva o no es de venta");
  }
  if (b.defaultCustomerId) {
    const c = await one<{ is_active: boolean }>(`SELECT is_active FROM customers WHERE id = $1`, [b.defaultCustomerId], client);
    if (!c?.is_active) throw badRequest("INVALID_CUSTOMER", "Cliente inexistente o inactivo");
  }
}

function uniqueViolation(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23505" && e.constraint === "uq_pos_terminals_code") throw conflict("DUPLICATED_CODE", "Ya existe una caja con ese código");
  if (e.code === "23505" && e.constraint === "uq_pos_terminals_prefix") throw conflict("DUPLICATED_PREFIX", "Otra caja ya usa ese prefijo de comprobantes");
  throw err;
}

export const createTerminal = handler({ body: terminalBody }, async ({ body: b, req, res }) => {
  const id = await withTx(txCtx(req), async (client) => {
    await assertRefs(client, b);
    try {
      const row = await one<{ id: string }>(
        `INSERT INTO pos_terminals (code, name, warehouse_id, price_list_id, default_customer_id, ticket_prefix, ticket_padding, notes, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, fn_current_app_user()) RETURNING id`,
        [b.code, b.name, b.warehouseId, b.priceListId ?? null, b.defaultCustomerId ?? null, b.ticketPrefix ?? `${b.code}-`, b.ticketPadding, b.notes ?? null, b.isActive],
        client
      );
      return row!.id;
    } catch (err) {
      uniqueViolation(err);
    }
  });
  res.status(201);
  return terminalDetail(id);
});

export const updateTerminal = handler({ params: idParams, body: terminalBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    const cur = await one<{ warehouse_id: string; ticket_prefix: string; open: boolean; sold: boolean }>(
      `SELECT warehouse_id, ticket_prefix,
              EXISTS (SELECT 1 FROM pos_sessions s WHERE s.terminal_id = t.id AND s.status = 'open') AS open,
              EXISTS (SELECT 1 FROM pos_sales v WHERE v.terminal_id = t.id) AS sold
         FROM pos_terminals t WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!cur) throw notFound("Caja no encontrada");
    if (cur.open && (cur.warehouse_id !== b.warehouseId || !b.isActive)) {
      throw conflict("SESSION_OPEN", "La caja tiene un turno abierto: ciérrelo antes de cambiar su almacén o desactivarla");
    }
    const prefix = b.ticketPrefix ?? cur.ticket_prefix;
    if (cur.sold && prefix !== cur.ticket_prefix) throw conflict("PREFIX_LOCKED", "La caja ya emitió comprobantes: su prefijo no cambia");
    await assertRefs(client, b);
    try {
      await client.query(
        `UPDATE pos_terminals SET code = $2, name = $3, warehouse_id = $4, price_list_id = $5, default_customer_id = $6, ticket_prefix = $7,
                ticket_padding = $8, notes = $9, is_active = $10, updated_by = fn_current_app_user()
          WHERE id = $1`,
        [params.id, b.code, b.name, b.warehouseId, b.priceListId ?? null, b.defaultCustomerId ?? null, prefix, b.ticketPadding, b.notes ?? null, b.isActive]
      );
    } catch (err) {
      uniqueViolation(err);
    }
  });
  return terminalDetail(params.id);
});

export const deleteTerminal = handler({ params: idParams }, async ({ params, req }) => {
  await withTx(txCtx(req), async (client) => {
    const used = await one<{ used: boolean }>(`SELECT EXISTS (SELECT 1 FROM pos_sessions WHERE terminal_id = $1) AS used`, [params.id], client);
    if (used?.used) throw conflict("IN_USE", "La caja ya tuvo turnos: desactívela en lugar de eliminarla");
    const r = await client.query(`DELETE FROM pos_terminals WHERE id = $1`, [params.id]);
    if (!r.rowCount) throw notFound("Caja no encontrada");
  });
  return undefined;
});
