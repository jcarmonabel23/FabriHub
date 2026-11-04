/**
 * @project FabriHub - API
 * @file src/modules/dashboard/rates.ts
 * @description Tarjeta del tablero: tipo de cambio oficial del dólar y del euro en la moneda local
 *
 * currencies_rates guarda unidades de la moneda BASE por 1 unidad de cada moneda; aquí se expresan
 * en la moneda LOCAL del país (Bs. en Venezuela, ₡ en Costa Rica), que es como las publica el
 * banco central: local por X = tasa(X) / tasa(local), con tasa(base) = 1.
 * La tasa vigente es la última con fecha ≤ hoy; si ya hay una publicada para después (el BCV
 * publica la del día hábil siguiente), se informa como «próxima». Sin la del día, pide una consulta
 * en segundo plano (refreshIfStale) y la tarjeta vuelve a preguntar.
 */

import { one, query } from "../../db.js";
import { handler } from "../../lib/http.js";
import { currentCountry } from "../../lib/taxId.js";
import { refreshIfStale } from "../settings/exchangeRates.js";

/** Monedas de referencia de la tarjeta */
const REFERENCE = ["USD", "EUR"];

const PROVIDER_NAME: Record<string, string> = { BCV: "Banco Central de Venezuela", BCCR: "Banco Central de Costa Rica" };

interface RateRow {
  code: string;
  rate: string;
  rateDate: string;
  source: string | null;
  isAutomatic: boolean;
  upcoming: boolean;
}

export const dashboardRates = handler({}, async () => {
  const country = await currentCountry();
  const base = (await one<{ code: string }>(
    `SELECT TRIM(cur.code) AS code FROM companies c JOIN catalogs_currencies cur ON cur.id = c.base_currency_id WHERE c.id = fn_current_company()`
  ))!.code;
  const local = country.currencyCode;
  const refreshing = await refreshIfStale();
  const codes = [...new Set([...REFERENCE, local])].filter((c) => c !== base);

  // Por moneda: la vigente (≤ hoy) y la próxima (> hoy), si existe
  const rows = await query<RateRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (TRIM(c.code), r.rate_date > CURRENT_DATE)
              TRIM(c.code) AS code, r.rate, to_char(r.rate_date, 'YYYY-MM-DD') AS "rateDate", r.source,
              r.is_automatic AS "isAutomatic", r.rate_date > CURRENT_DATE AS upcoming
         FROM currencies_rates r JOIN catalogs_currencies c ON c.id = r.currency_id
        WHERE TRIM(c.code) = ANY($1::text[])
        ORDER BY TRIM(c.code), r.rate_date > CURRENT_DATE,
                 CASE WHEN r.rate_date > CURRENT_DATE THEN r.rate_date END ASC, r.rate_date DESC
     ) x`,
    [codes]
  );
  const pick = (code: string, upcoming: boolean) => rows.find((r) => r.code === code && r.upcoming === upcoming) ?? null;
  const inBase = (code: string, upcoming: boolean) => (code === base ? 1 : Number((pick(code, upcoming) ?? pick(code, false))?.rate ?? NaN));

  const currencies = await query<{ code: string; name: string; symbol: string }>(
    `SELECT TRIM(code) AS code, name, symbol FROM catalogs_currencies WHERE TRIM(code) = ANY($1::text[])`,
    [[...REFERENCE, local]]
  );
  const meta = (code: string) => currencies.find((c) => c.code === code);

  const rates = REFERENCE.filter((code) => code !== local).map((code) => {
    const current = code === base ? null : pick(code, false);
    const next = code === base ? null : pick(code, true);
    // Si la base es la moneda de referencia, manda la fecha de la tasa local
    const dated = code === base ? pick(local, false) : current;
    const value = (upcoming: boolean) => {
      const v = inBase(code, upcoming) / inBase(local, upcoming);
      return Number.isFinite(v) && v > 0 ? Number(v.toFixed(4)) : null;
    };
    const nextDated = next ?? (code === base ? pick(local, true) : null);
    return {
      code,
      name: meta(code)?.name ?? code,
      symbol: meta(code)?.symbol ?? null,
      rate: dated ? value(false) : null,
      rateDate: dated?.rateDate ?? null,
      source: dated?.source ?? null,
      official: Boolean(dated?.isAutomatic),
      next: nextDated ? { rate: value(true), rateDate: nextDated.rateDate } : null
    };
  });

  const lastRun = await one<{ status: string; finishedAt: string | null; message: string | null }>(
    `SELECT status, finished_at AS "finishedAt", message FROM exchange_rate_runs ORDER BY started_at DESC LIMIT 1`
  );
  return {
    local: { code: local, symbol: meta(local)?.symbol ?? null },
    provider: country.rateProvider ? { code: country.rateProvider, name: PROVIDER_NAME[country.rateProvider] ?? country.rateProvider } : null,
    refreshing,
    rates,
    lastRun
  };
});
