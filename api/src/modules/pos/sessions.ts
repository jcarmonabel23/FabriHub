/**
 * @project FabriHub - API
 * @file src/modules/pos/sessions.ts
 * @description Turnos de caja (POS_SESSIONS): apertura con fondo y cierre con arqueo
 *
 * @overview
 * - Abrir: el cajero toma una caja activa sin turno abierto y declara el fondo en efectivo
 *   (una fila por moneda). Una caja y un cajero tienen a lo sumo un turno abierto.
 * - Esperado por medio y moneda = fondo + cobrado − vuelto entregado (ventas no anuladas).
 * - Cerrar: el cajero declara lo contado. El efectivo debe contarse; los medios electrónicos
 *   que no se declaren se dan por conciliados (contado = esperado). Si la diferencia total en
 *   moneda base supera POS.max_cash_difference, el cierre exige una observación.
 * - Sin view_all, cada usuario ve y cierra solo sus turnos.
 */

import type { Request } from "express";
import { z } from "zod";
import { one, query, withTx, type Db } from "../../db.js";
import { badRequest, conflict, forbidden, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { authOf, txCtx } from "../../security/context.js";
import { exchangeRate } from "../purchases/fiscal.js";

export const METHODS = ["cash", "card", "mobile", "transfer"] as const;
export type PaymentMethod = (typeof METHODS)[number];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** null = todos; si no, solo los del usuario */
const ownerScope = (req: Request) => (req.modulePermissions?.includes("view_all") ? null : authOf(req).userId);

const HEADER = `SELECT s.id, s.number, s.status, s.terminal_id AS "terminalId", t.code AS "terminalCode", t.name AS "terminalName",
       t.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
       s.cashier_id AS "cashierId", u.names AS "cashierName", s.opened_at AS "openedAt", s.closed_at AS "closedAt",
       cb.names AS "closedByName", s.sales_count AS "salesCount", s.sales_total::float AS "salesTotal",
       s.difference_total::float AS "differenceTotal", s.opening_notes AS "openingNotes", s.closing_notes AS "closingNotes"
  FROM pos_sessions s
  JOIN pos_terminals t ON t.id = s.terminal_id
  JOIN warehouses w ON w.id = t.warehouse_id
  JOIN users u ON u.id = s.cashier_id
  LEFT JOIN users cb ON cb.id = s.closed_by`;

export interface CountRow {
  method: PaymentMethod;
  currencyId: string;
  currencyCode: string;
  isBase: boolean;
  opening: number;
  received: number;
  change: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

/** Arqueo del turno: esperado por medio y moneda (y lo contado, si ya cerró) */
export async function sessionCounts(sessionId: string, db?: Db): Promise<CountRow[]> {
  return query<CountRow>(
    `WITH pay AS (
       SELECT p.method, p.currency_id, SUM(p.amount) AS amount
         FROM pos_sales_payments p JOIN pos_sales v ON v.id = p.sale_id
        WHERE v.session_id = $1 AND v.status = 'completed'
        GROUP BY 1, 2),
     chg AS (
       SELECT 'cash'::varchar AS method, v.change_currency_id AS currency_id, SUM(v.change_in_currency) AS amount
         FROM pos_sales v
        WHERE v.session_id = $1 AND v.status = 'completed' AND v.change_amount > 0
        GROUP BY 2),
     keys AS (
       SELECT method, currency_id FROM pos_sessions_counts WHERE session_id = $1
       UNION SELECT method, currency_id FROM pay
       UNION SELECT method, currency_id FROM chg)
     SELECT k.method, k.currency_id AS "currencyId", cur.code AS "currencyCode", (cur.id = co.base_currency_id) AS "isBase",
            COALESCE(o.opening_amount, 0)::float AS opening, COALESCE(pay.amount, 0)::float AS received, COALESCE(chg.amount, 0)::float AS change,
            (COALESCE(o.opening_amount, 0) + COALESCE(pay.amount, 0) - COALESCE(chg.amount, 0))::float AS expected,
            o.counted_amount::float AS counted, o.difference::float AS difference
       FROM keys k
       JOIN catalogs_currencies cur ON cur.id = k.currency_id
       CROSS JOIN companies co
       LEFT JOIN pos_sessions_counts o ON o.session_id = $1 AND o.method = k.method AND o.currency_id = k.currency_id
       LEFT JOIN pay ON pay.method = k.method AND pay.currency_id = k.currency_id
       LEFT JOIN chg ON chg.method = k.method AND chg.currency_id = k.currency_id
      WHERE co.id = fn_current_company()
      ORDER BY array_position(ARRAY['cash', 'card', 'mobile', 'transfer']::varchar[], k.method), (cur.id = co.base_currency_id) DESC, cur.code`,
    [sessionId],
    db
  );
}

export async function sessionDetail(id: string, scope: string | null, db?: Db) {
  const s = await one<{ cashierId: string }>(`${HEADER} WHERE s.id = $1`, [id], db);
  if (!s || (scope && s.cashierId !== scope)) throw notFound("Turno no encontrado");
  const [counts, totals] = await Promise.all([
    sessionCounts(id, db),
    one(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS completed, COUNT(*) FILTER (WHERE status = 'voided')::int AS voided,
              COALESCE(SUM(grand_total) FILTER (WHERE status = 'completed'), 0)::float AS "grandTotal",
              COALESCE(SUM(tax_amount) FILTER (WHERE status = 'completed'), 0)::float AS "taxAmount",
              COALESCE(SUM(igtf_amount) FILTER (WHERE status = 'completed'), 0)::float AS "igtfAmount"
         FROM pos_sales WHERE session_id = $1`,
      [id],
      db
    )
  ]);
  return { ...s, counts, totals };
}

// ------------------------------------------------------------------ Consultas

const listQuery = pageQuery.extend({
  status: z.enum(["open", "closed"]).optional(),
  terminalId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
});

export const listSessions = handler({ query: listQuery }, async ({ query: q, req }) => {
  const rows = await query(
    `${HEADER.replace("SELECT s.id,", "SELECT COUNT(*) OVER()::int AS total_rows, s.id,")}
      WHERE ($1::text IS NULL OR s.status = $1)
        AND ($2::uuid IS NULL OR s.terminal_id = $2)
        AND ($3::date IS NULL OR s.opened_at >= $3::date)
        AND ($4::date IS NULL OR s.opened_at < $4::date + 1)
        AND ($5::uuid IS NULL OR s.cashier_id = $5)
      ORDER BY s.opened_at DESC
      LIMIT $6 OFFSET $7`,
    [q.status ?? null, q.terminalId ?? null, q.from ?? null, q.to ?? null, ownerScope(req), q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = (rows[0]?.total_rows as number | undefined) ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total, page: q.page, pageSize: q.pageSize };
});

export const getSession = handler({ params: idParams }, async ({ params, req }) => sessionDetail(params.id, ownerScope(req)));

/** El turno abierto del usuario (o null) y las cajas que puede abrir: arranque de la pantalla de venta */
export const mySession = handler({}, async ({ req }) => {
  const open = await one<{ id: string }>(`SELECT id FROM pos_sessions WHERE cashier_id = $1 AND status = 'open'`, [authOf(req).userId]);
  const terminals = await query(
    `SELECT t.id, t.code, t.name, w.code AS "warehouseCode", pl.name AS "priceListName",
            EXISTS (SELECT 1 FROM pos_sessions s WHERE s.terminal_id = t.id AND s.status = 'open') AS "isBusy"
       FROM pos_terminals t JOIN warehouses w ON w.id = t.warehouse_id LEFT JOIN price_lists pl ON pl.id = t.price_list_id
      WHERE t.is_active ORDER BY t.code`
  );
  // Monedas cobrables hoy (la base y las que tienen tasa) y los parámetros que la pantalla muestra
  const currencies = await query(
    `SELECT * FROM (
       SELECT c.id, c.code, c.name, c.symbol, (c.id = co.base_currency_id) AS "isBase",
              CASE WHEN c.id = co.base_currency_id THEN 1
                   ELSE (SELECT r.rate FROM currencies_rates r WHERE r.currency_id = c.id AND r.rate_date <= CURRENT_DATE
                          ORDER BY r.rate_date DESC LIMIT 1) END::float AS rate
         FROM catalogs_currencies c CROSS JOIN companies co
        WHERE c.is_active AND co.id = fn_current_company()) x
      WHERE rate IS NOT NULL
      ORDER BY "isBase" DESC, code`
  );
  const settings = await one(
    `SELECT COALESCE((fn_parameter('POS', 'max_discount_pct'))::text::numeric, 0)::float AS "maxDiscountPct",
            COALESCE((fn_parameter('POS', 'igtf_enabled'))::text::boolean, FALSE) AS "igtfEnabled",
            COALESCE((fn_parameter('POS', 'igtf_rate'))::text::numeric, 0)::float AS "igtfRate"`
  );
  return { session: open ? await sessionDetail(open.id, null) : null, terminals, currencies, settings };
});

// ------------------------------------------------------------------ Abrir

const openBody = z.object({
  terminalId: z.uuid(),
  openingFloat: z
    .array(z.object({ currencyId: z.uuid(), amount: z.number().min(0).max(1e12) }))
    .max(10)
    .default([]),
  notes: z.string().trim().max(400).nullish()
});

export const openSession = handler({ body: openBody }, async ({ body: b, req, res }) => {
  const currencies = b.openingFloat.map((f) => f.currencyId);
  if (new Set(currencies).size !== currencies.length) throw badRequest("DUPLICATED_CURRENCY", "Una moneda aparece dos veces en el fondo");
  const id = await withTx(txCtx(req), async (client) => {
    const t = await one<{ is_active: boolean; code: string }>(`SELECT is_active, code FROM pos_terminals WHERE id = $1 FOR UPDATE`, [b.terminalId], client);
    if (!t) throw notFound("Caja no encontrada");
    if (!t.is_active) throw conflict("TERMINAL_INACTIVE", `La caja ${t.code} está desactivada`);
    const busy = await one<{ number: string; names: string; mine: boolean }>(
      `SELECT s.number, u.names, (s.cashier_id = $2) AS mine FROM pos_sessions s JOIN users u ON u.id = s.cashier_id
        WHERE s.status = 'open' AND (s.terminal_id = $1 OR s.cashier_id = $2) ORDER BY (s.terminal_id = $1) DESC LIMIT 1`,
      [b.terminalId, authOf(req).userId],
      client
    );
    if (busy?.mine) throw conflict("CASHIER_BUSY", `Ya tiene abierto el turno ${busy.number}: ciérrelo antes de abrir otro`);
    if (busy) throw conflict("TERMINAL_BUSY", `La caja ${t.code} ya tiene un turno abierto (${busy.number}, ${busy.names})`);

    const s = await one<{ id: string }>(
      `INSERT INTO pos_sessions (number, terminal_id, cashier_id, opening_notes) VALUES (fn_next_document_number('TUR'), $1, $2, $3) RETURNING id`,
      [b.terminalId, authOf(req).userId, b.notes ?? null],
      client
    );
    for (const f of b.openingFloat) {
      const cur = await one(`SELECT 1 FROM catalogs_currencies WHERE id = $1 AND is_active`, [f.currencyId], client);
      if (!cur) throw badRequest("INVALID_CURRENCY", "Moneda inexistente o inactiva");
      await client.query(`INSERT INTO pos_sessions_counts (session_id, method, currency_id, opening_amount) VALUES ($1, 'cash', $2, $3)`, [
        s!.id,
        f.currencyId,
        round2(f.amount)
      ]);
    }
    return s!.id;
  });
  res.status(201);
  return sessionDetail(id, null);
});

// ------------------------------------------------------------------ Cerrar

const closeBody = z.object({
  counts: z
    .array(z.object({ method: z.enum(METHODS), currencyId: z.uuid(), amount: z.number().min(0).max(1e12) }))
    .max(40)
    .default([]),
  notes: z.string().trim().max(800).nullish()
});

export const closeSession = handler({ params: idParams, body: closeBody }, async ({ params, body: b, req }) => {
  const keys = b.counts.map((c) => `${c.method}:${c.currencyId}`);
  if (new Set(keys).size !== keys.length) throw badRequest("DUPLICATED_COUNT", "Un medio de pago y moneda aparece dos veces en el arqueo");
  const scope = ownerScope(req);
  await withTx(txCtx(req), async (client) => {
    const s = await one<{ status: string; number: string; cashier_id: string }>(
      `SELECT status, number, cashier_id FROM pos_sessions WHERE id = $1 FOR UPDATE`,
      [params.id],
      client
    );
    if (!s || (scope && s.cashier_id !== scope)) throw notFound("Turno no encontrado");
    if (s.status !== "open") throw conflict("SESSION_CLOSED", `El turno ${s.number} ya está cerrado`);

    const expected = await sessionCounts(params.id, client);
    const declared = new Map(b.counts.map((c) => [`${c.method}:${c.currencyId}`, c.amount]));
    // Lo declarado que no se esperaba (p. ej. efectivo en una moneda que no se cobró) también cuenta
    const rows = [...expected];
    for (const c of b.counts) {
      if (!rows.some((e) => e.method === c.method && e.currencyId === c.currencyId)) {
        rows.push({ method: c.method, currencyId: c.currencyId, currencyCode: "", opening: 0, expected: 0 } as CountRow);
      }
    }
    const missingCash = rows.filter((r) => r.method === "cash" && r.expected > 0 && !declared.has(`cash:${r.currencyId}`));
    if (missingCash.length) {
      throw badRequest("CASH_NOT_COUNTED", `Declare el efectivo contado en ${missingCash.map((r) => r.currencyCode).join(", ")}`);
    }

    const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`, [], client))!.d;
    let differenceBase = 0;
    for (const r of rows) {
      const counted = round2(declared.get(`${r.method}:${r.currencyId}`) ?? r.expected);
      const difference = round2(counted - r.expected);
      const rate = await exchangeRate(client, r.currencyId, today);
      differenceBase += difference * rate;
      await client.query(
        `INSERT INTO pos_sessions_counts (session_id, method, currency_id, opening_amount, expected_amount, counted_amount, difference, exchange_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_id, session_id, method, currency_id)
         DO UPDATE SET expected_amount = EXCLUDED.expected_amount, counted_amount = EXCLUDED.counted_amount,
                       difference = EXCLUDED.difference, exchange_rate = EXCLUDED.exchange_rate`,
        [params.id, r.method, r.currencyId, r.opening ?? 0, round2(r.expected), counted, difference, rate]
      );
    }
    differenceBase = round2(differenceBase);
    const tolerance = (await one<{ v: number }>(`SELECT COALESCE((fn_parameter('POS', 'max_cash_difference'))::text::numeric, 0)::float AS v`, [], client))!.v;
    if (Math.abs(differenceBase) > tolerance + 0.004 && !b.notes) {
      throw badRequest("NOTES_REQUIRED", `El arqueo tiene una diferencia de ${differenceBase.toFixed(2)} en moneda base: explíquela en la observación`);
    }

    await client.query(
      `UPDATE pos_sessions s SET status = 'closed', closed_at = NOW(), closed_by = fn_current_app_user(), closing_notes = $2, difference_total = $3,
              sales_count = (SELECT COUNT(*) FROM pos_sales v WHERE v.session_id = s.id AND v.status = 'completed'),
              sales_total = (SELECT COALESCE(SUM(v.grand_total), 0) FROM pos_sales v WHERE v.session_id = s.id AND v.status = 'completed')
        WHERE id = $1`,
      [params.id, b.notes ?? null, differenceBase]
    );
  });
  return sessionDetail(params.id, null);
});

/** Turno abierto del cajero en esa caja: requisito para vender (lo bloquea hasta el fin de la transacción) */
export async function lockOwnSession(db: Db, sessionId: string, userId: string) {
  const s = await one<{ status: string; number: string; cashier_id: string; terminal_id: string }>(
    `SELECT status, number, cashier_id, terminal_id FROM pos_sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
    db
  );
  if (!s) throw notFound("Turno no encontrado");
  if (s.cashier_id !== userId) throw forbidden("NOT_YOUR_SESSION", `El turno ${s.number} es de otro cajero`);
  if (s.status !== "open") throw conflict("SESSION_CLOSED", `El turno ${s.number} está cerrado: abra uno nuevo`);
  return s;
}
