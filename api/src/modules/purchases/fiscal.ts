/**
 * @project FabriHub - API
 * @file src/modules/purchases/fiscal.ts
 * @description Datos fiscales y cambiarios que necesitan los documentos (compras hoy, ventas en la fase 6)
 */

import type pg from "pg";
import { one, query, type Db } from "../../db.js";
import { HttpError, badRequest } from "../../lib/http.js";
import type { Bracket } from "../taxes/engine.js";
import type { TreatmentInfo } from "../taxes/document.js";

/** Tasa de la moneda a moneda base vigente en la fecha (la última registrada ≤ fecha). Base = 1. */
export async function exchangeRate(db: Db, currencyId: string, date: string): Promise<number> {
  const row = await one<{ is_base: boolean; rate: string | null; code: string }>(
    `SELECT (c.id = co.base_currency_id) AS is_base, c.code,
            (SELECT r.rate FROM currencies_rates r WHERE r.currency_id = c.id AND r.rate_date <= $2::date
              ORDER BY r.rate_date DESC LIMIT 1) AS rate
       FROM catalogs_currencies c CROSS JOIN company co WHERE c.id = $1 AND co.id = 1`,
    [currencyId, date],
    db
  );
  if (!row) throw badRequest("INVALID_CURRENCY", "Moneda inexistente");
  if (row.is_base) return 1;
  if (!row.rate) {
    throw new HttpError(400, "NO_EXCHANGE_RATE", `No hay tasa de ${row.code} registrada al ${date}: regístrela en Catálogos comerciales → Monedas`);
  }
  return Number(row.rate);
}

/** ¿La empresa retiene? (agente de retención Y parámetro apply_withholdings activo) */
export async function appliesWithholdings(db: Db): Promise<boolean> {
  const row = await one<{ ok: boolean }>(
    `SELECT (co.is_withholding_agent AND COALESCE((fn_parameter('TAXES', 'apply_withholdings'))::text::boolean, FALSE)) AS ok
       FROM company co WHERE co.id = 1`,
    [],
    db
  );
  return Boolean(row?.ok);
}

/** Tratamientos fiscales vigentes en la fecha, listos para resolveTreatment/computeDocument */
export async function loadTreatments(db: Db | pg.PoolClient, ids: string[], date: string): Promise<Map<string, TreatmentInfo>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await query<{
    id: string;
    code: string;
    calc_method: TreatmentInfo["calcMethod"];
    tax_rate: number;
    valid: boolean;
    wh_rate_id: string | null;
    wh_label: string | null;
    base_on: "amount" | "tax" | null;
    brackets: Bracket[] | null;
  }>(
    `SELECT f.id, f.code, f.calc_method, tr.rate::float AS tax_rate,
            (f.is_active AND tr.is_active AND f.valid_from <= $2::date AND (f.valid_to IS NULL OR f.valid_to >= $2::date)
             AND (wr.id IS NULL OR wr.is_active)) AS valid,
            wr.id AS wh_rate_id, w.code || ' · ' || wr.name AS wh_label, w.base_on,
            (SELECT jsonb_agg(jsonb_build_object('fromAmount', b.from_amount::float, 'rate', b.rate::float, 'subtrahend', b.subtrahend::float))
               FROM withholdings_brackets b WHERE b.withholding_rate_id = wr.id) AS brackets
       FROM fiscal_treatments f
       JOIN taxes_rates tr ON tr.id = f.tax_rate_id
       LEFT JOIN withholdings_rates wr ON wr.id = f.withholding_rate_id
       LEFT JOIN withholdings w ON w.id = wr.withholding_id
      WHERE f.id = ANY($1)`,
    [unique, date],
    db
  );
  const map = new Map<string, TreatmentInfo>();
  for (const r of rows) {
    if (!r.valid) {
      throw new HttpError(409, "TREATMENT_NOT_VALID", `El tratamiento fiscal ${r.code} no está activo o vigente el ${date}`);
    }
    map.set(r.id, {
      id: r.id,
      code: r.code,
      calcMethod: r.calc_method,
      taxRate: r.tax_rate,
      withholding:
        r.wh_rate_id && r.base_on
          ? { rateId: r.wh_rate_id, label: r.wh_label ?? "", baseOn: r.base_on, brackets: r.brackets ?? [] }
          : null
    });
  }
  return map;
}
