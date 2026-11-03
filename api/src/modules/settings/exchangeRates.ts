/**
 * @project FabriHub - API
 * @file src/modules/settings/exchangeRates.ts
 * @description Tipos de cambio automáticos (fase 16): proveedores oficiales por país, consulta
 * programada por empresa, botón «Actualizar ahora» y token cifrado del BCCR
 *
 * @overview
 * Cada proveedor devuelve cotizaciones en la moneda LOCAL de su país (Bs. por dólar, colones por
 * dólar). Se convierten a la moneda base de la empresa (unidades de base por 1 unidad de la moneda,
 * como currencies_rates) y se registran con rate_date = fecha valor de la fuente.
 *   · BCV (Venezuela): no tiene API; se lee la página oficial (USD, EUR, CNY, TRY, RUB).
 *   · BCCR (Costa Rica): API SDDE con token propio de la empresa; indicador 318 (venta) o 317 (compra).
 * Una tasa cargada a mano nunca se reemplaza (is_automatic = FALSE); la consulta la reporta como
 * «kept_manual». Cada consulta queda en exchange_rate_runs; si la última falló, el detector de
 * alertas avisa (RATES_FAILED).
 */

import { z } from "zod";
import { config } from "../../config.js";
import { one, query, runInCompany, withTx } from "../../db.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { badRequest, conflict, handler } from "../../lib/http.js";
import { fetchText } from "../../lib/httpFetch.js";
import { logger } from "../../lib/logger.js";
import { currentCountry, type Country } from "../../lib/taxId.js";
import { authOf, txCtx } from "../../security/context.js";

// ------------------------------------------------------------------ Proveedores

/** Cotización en moneda local: cuántas unidades locales vale 1 unidad de `currency` */
interface Quote {
  currency: string;
  /** Fecha valor publicada por la fuente (YYYY-MM-DD); es la fecha en que rige la tasa */
  valueDate: string;
  perUnit: number;
}

interface ProviderContext {
  /** Hoy en la zona de la empresa (YYYY-MM-DD) */
  today: string;
  token: string | null;
  bccrSide: "sell" | "buy";
  /** Solo fuera de producción: URL de un servidor simulado (pruebas de humo) */
  baseUrl?: string;
}

interface RateProvider {
  code: "BCV" | "BCCR";
  name: string;
  /** Moneda en la que cotiza la fuente */
  local: string;
  needsToken: boolean;
  fetch(ctx: ProviderContext): Promise<Quote[]>;
}

class ProviderError extends Error {}

/** «891,10540000» o «1.234,56» → número */
const parseEsNumber = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));

const BCV_URL = "https://www.bcv.org.ve/";
/** Bloques de la página del BCV (id del div → moneda) */
const BCV_BLOCKS: Record<string, string> = { dolar: "USD", euro: "EUR", yuan: "CNY", lira: "TRY", rublo: "RUB" };

const bcv: RateProvider = {
  code: "BCV",
  name: "Banco Central de Venezuela",
  local: "VES",
  needsToken: false,
  async fetch(ctx) {
    const res = await fetchText(ctx.baseUrl ?? BCV_URL, { timeoutMs: 30_000 });
    if (res.status !== 200) throw new ProviderError(`La página del BCV respondió ${res.status}`);
    const html = res.body;
    // Fecha valor: <span class="date-display-single" ... content="2026-11-03T00:00:00-04:00">
    const valueDate = /class="date-display-single"[^>]*content="(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
    if (!valueDate) throw new ProviderError("No se encontró la fecha valor en la página del BCV (¿cambió su diseño?)");
    const quotes: Quote[] = [];
    for (const [id, currency] of Object.entries(BCV_BLOCKS)) {
      const at = html.indexOf(`id="${id}"`);
      if (at < 0) continue;
      const m = /<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/.exec(html.slice(at, at + 1500));
      if (m) quotes.push({ currency, valueDate, perUnit: parseEsNumber(m[1]) });
    }
    if (!quotes.some((q) => q.currency === "USD")) throw new ProviderError("No se encontró la tasa del dólar en la página del BCV (¿cambió su diseño?)");
    return quotes;
  }
};

const BCCR_URL = "https://apim.bccr.fi.cr/SDDE/api/Bccr.GE.SDDE.Publico.Indicadores.API";
/** Tipo de cambio de referencia colón/dólar: 317 compra, 318 venta */
const BCCR_INDICATOR = { buy: 317, sell: 318 } as const;

const shiftDate = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const bccr: RateProvider = {
  code: "BCCR",
  name: "Banco Central de Costa Rica",
  local: "CRC",
  needsToken: true,
  async fetch(ctx) {
    if (!ctx.token) throw new ProviderError("Falta el token del BCCR: genérelo en el sitio de Indicadores Económicos y cárguelo aquí");
    const slash = (d: string) => d.replace(/-/g, "/");
    const code = BCCR_INDICATOR[ctx.bccrSide];
    // Una semana hacia atrás: completa los días que la tarea no haya alcanzado a registrar
    const url = `${ctx.baseUrl ?? BCCR_URL}/indicadoresEconomicos/${code}/series?fechainicio=${slash(shiftDate(ctx.today, -7))}&fechafin=${slash(shiftDate(ctx.today, 1))}&idioma=ES`;
    const res = await fetchText(url, { timeoutMs: 30_000, headers: { authorization: `Bearer ${ctx.token}`, accept: "application/json" } });
    if (res.status === 401 || res.status === 403) throw new ProviderError("El BCCR rechazó el token (vencido o inválido): genere uno nuevo y cárguelo");
    if (res.status !== 200) throw new ProviderError(`El BCCR respondió ${res.status}`);
    let series: { fecha?: string; valorDatoPorPeriodo?: number | string }[];
    try {
      series = JSON.parse(res.body)?.datos?.[0]?.series ?? [];
    } catch {
      throw new ProviderError("Respuesta del BCCR no reconocida");
    }
    const quotes = series
      .filter((s) => s.fecha && s.valorDatoPorPeriodo !== undefined && s.valorDatoPorPeriodo !== null)
      .map((s) => ({
        currency: "USD",
        valueDate: String(s.fecha).slice(0, 10).replace(/\//g, "-"),
        perUnit: typeof s.valorDatoPorPeriodo === "number" ? s.valorDatoPorPeriodo : Number(String(s.valorDatoPorPeriodo).replace(",", "."))
      }));
    if (!quotes.length) throw new ProviderError("El BCCR no devolvió datos para la última semana");
    return quotes;
  }
};

const PROVIDERS: Record<string, RateProvider> = { BCV: bcv, BCCR: bccr };

// ------------------------------------------------------------------ Secretos

const BCCR_TOKEN = "bccr_token";

async function readSecret(key: string): Promise<string | null> {
  const row = await one<{ ciphertext: string }>(`SELECT ciphertext FROM company_secrets WHERE key = $1`, [key]);
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext);
  } catch {
    throw new ProviderError("El token guardado no se puede descifrar (cambió la clave del servidor): vuelva a cargarlo");
  }
}

// ------------------------------------------------------------------ Consulta

type Action = "inserted" | "updated" | "unchanged" | "kept_manual";

interface RunRate {
  currency: string;
  rateDate: string;
  rate: number;
  action: Action;
}

export interface RateRun {
  id: string;
  provider: string;
  trigger: "schedule" | "manual";
  status: "running" | "ok" | "partial" | "error";
  message: string | null;
  rates: RunRate[];
  startedAt: string;
  finishedAt: string | null;
  createdBy: string | null;
}

const RUN_SELECT = `SELECT r.id, r.provider, r.trigger, r.status, r.message, r.rates, r.started_at AS "startedAt",
  r.finished_at AS "finishedAt", u.names AS "createdBy"
  FROM exchange_rate_runs r LEFT JOIN users u ON u.id = r.created_by`;

/** Empresas con una consulta en curso (una a la vez por empresa; la API corre en un solo proceso) */
const running = new Set<string>();

const settingValue = async <T>(key: string, fallback: T): Promise<T> =>
  (await one<{ value: T | null }>(`SELECT fn_parameter('SETTINGS', $1) AS value`, [key]))?.value ?? fallback;

/** Convierte cotizaciones locales a la moneda base y las registra; devuelve qué pasó con cada una */
async function storeQuotes(provider: RateProvider, quotes: Quote[], userId: string | null): Promise<{ rates: RunRate[]; skipped: string[] }> {
  const base = (await one<{ code: string }>(
    `SELECT cur.code FROM companies c JOIN catalogs_currencies cur ON cur.id = c.base_currency_id WHERE c.id = fn_current_company()`
  ))!.code.trim();
  const catalog = await query<{ id: string; code: string }>(`SELECT id, TRIM(code) AS code FROM catalogs_currencies WHERE is_active`);
  const idOf = new Map(catalog.map((c) => [c.code, c.id]));

  const skipped: string[] = [];
  const valid = quotes.filter((q) => {
    const ok = Number.isFinite(q.perUnit) && q.perUnit > 0 && q.perUnit < 1e12 && /^\d{4}-\d{2}-\d{2}$/.test(q.valueDate);
    if (!ok) skipped.push(`${q.currency} ${q.valueDate}: valor no válido`);
    return ok;
  });
  // Por fecha: unidades locales por 1 unidad de cada moneda (la local vale 1)
  const byDate = new Map<string, Map<string, number>>();
  for (const q of valid) {
    if (!byDate.has(q.valueDate)) byDate.set(q.valueDate, new Map([[provider.local, 1]]));
    byDate.get(q.valueDate)!.set(q.currency, q.perUnit);
  }

  const out: { currencyId: string; currency: string; rateDate: string; rate: number }[] = [];
  for (const [date, perUnit] of byDate) {
    const basePer = perUnit.get(base);
    if (!basePer) {
      skipped.push(`${date}: la fuente no cotiza la moneda base (${base})`);
      continue;
    }
    for (const [currency, local] of perUnit) {
      if (currency === base || !idOf.has(currency)) continue;
      out.push({ currencyId: idOf.get(currency)!, currency, rateDate: date, rate: Number((local / basePer).toFixed(8)) });
    }
  }

  const rates = await withTx({ userId }, async (client) => {
    const result: RunRate[] = [];
    for (const r of out) {
      const existing = (
        await client.query<{ rate: string; is_automatic: boolean }>(
          `SELECT rate, is_automatic FROM currencies_rates WHERE currency_id = $1 AND rate_date = $2 FOR UPDATE`,
          [r.currencyId, r.rateDate]
        )
      ).rows[0];
      let action: Action;
      if (!existing) {
        await client.query(
          `INSERT INTO currencies_rates (currency_id, rate_date, rate, source, is_automatic, value_date, created_by)
           VALUES ($1, $2, $3, $4, TRUE, $2, NULLIF($5, '')::uuid)`,
          [r.currencyId, r.rateDate, r.rate, provider.code, userId ?? ""]
        );
        action = "inserted";
      } else if (!existing.is_automatic) {
        action = "kept_manual";
      } else if (Number(existing.rate) === r.rate) {
        action = "unchanged";
      } else {
        await client.query(
          `UPDATE currencies_rates SET rate = $3, source = $4, value_date = $2 WHERE currency_id = $1 AND rate_date = $2`,
          [r.currencyId, r.rateDate, r.rate, provider.code]
        );
        action = "updated";
      }
      result.push({ currency: r.currency, rateDate: r.rateDate, rate: r.rate, action });
    }
    return result;
  });
  return { rates, skipped };
}

/**
 * @function runRates
 * @description Una consulta completa para la empresa activa. Siempre deja su registro en la bitácora.
 */
export async function runRates(trigger: "schedule" | "manual", userId: string | null, baseUrl?: string): Promise<RateRun> {
  const country = await currentCountry();
  const provider = country.rateProvider ? PROVIDERS[country.rateProvider] : undefined;
  if (!provider) throw badRequest("NO_RATE_PROVIDER", `${country.name} no tiene una fuente automática de tasas: cárguelas a mano`);
  const companyId = (await one<{ id: string }>(`SELECT fn_current_company() AS id`))!.id;
  if (running.has(companyId)) throw conflict("RATES_RUNNING", "Ya hay una consulta de tasas en curso");
  running.add(companyId);
  try {
    const run = (await withTx({ userId }, async (client) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO exchange_rate_runs (provider, trigger, created_by) VALUES ($1, $2, NULLIF($3, '')::uuid) RETURNING id`,
          [provider.code, trigger, userId ?? ""]
        )
      ).rows[0]
    ))!;
    let status: RateRun["status"] = "ok";
    let message: string | null = null;
    let rates: RunRate[] = [];
    try {
      const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`))!.d;
      const quotes = await provider.fetch({
        today,
        token: provider.needsToken ? await readSecret(BCCR_TOKEN) : null,
        bccrSide: (await settingValue<string>("rates_bccr_side", "sell")) === "buy" ? "buy" : "sell",
        baseUrl
      });
      const stored = await storeQuotes(provider, quotes, userId);
      rates = stored.rates;
      if (stored.skipped.length) {
        status = rates.length ? "partial" : "error";
        message = stored.skipped.join("; ").slice(0, 600);
      }
    } catch (err) {
      status = "error";
      message =
        err instanceof ProviderError
          ? err.message
          : `No se pudo consultar ${provider.name}: ${(err as { code?: string }).code ?? (err as Error).message}`.slice(0, 600);
      if (!(err instanceof ProviderError)) logger.warn({ err, provider: provider.code }, "[rates] la consulta falló");
    }
    await withTx({ userId }, (client) =>
      client.query(`UPDATE exchange_rate_runs SET status = $2, message = $3, rates = $4, finished_at = NOW() WHERE id = $1`, [
        run.id,
        status,
        message,
        JSON.stringify(rates)
      ])
    );
    return (await one<RateRun>(`${RUN_SELECT} WHERE r.id = $1`, [run.id]))!;
  } finally {
    running.delete(companyId);
  }
}

// ------------------------------------------------------------------ Tarea programada

const TICK_MS = 10 * 60_000;
let timer: NodeJS.Timeout | null = null;

/** Consulta de la empresa activa si tiene la actualización automática activa y ya le toca */
async function scheduledRunIfDue(companyId: string): Promise<void> {
  try {
    if (!(await settingValue("rates_auto_enabled", false))) return;
    const country = await currentCountry();
    if (!country.rateProvider) return;
    const hours = Math.min(24, Math.max(1, Number(await settingValue("rates_interval_hours", 4)) || 4));
    // Tras un error se reintenta a la hora, sin esperar el intervalo completo
    const due = await one<{ due: boolean }>(
      `SELECT COALESCE((SELECT started_at < NOW() - make_interval(hours => CASE WHEN status = 'error' THEN 1 ELSE $1 END) + INTERVAL '1 minute'
                          FROM exchange_rate_runs WHERE trigger = 'schedule' ORDER BY started_at DESC LIMIT 1), TRUE) AS due`,
      [hours]
    );
    if (!due?.due) return;
    const run = await runRates("schedule", null);
    logger.info({ companyId, status: run.status, rates: run.rates.length }, "[rates] consulta programada");
  } catch (err) {
    if ((err as { code?: string }).code === "RATES_RUNNING") return;
    logger.error({ err, companyId }, "[rates] la consulta programada falló");
  }
}

/** Revisa cada 10 minutos qué empresas deben consultar su tasa (primera revisión a los 2 minutos) */
export function startRatesScheduler(firstDelayMs = 120_000): void {
  const tick = async () => {
    try {
      const companies = await query<{ id: string }>(`SELECT id FROM companies WHERE is_active ORDER BY code`);
      for (const c of companies) await runInCompany(c.id, () => scheduledRunIfDue(c.id));
    } catch (err) {
      logger.error({ err }, "[rates] no se pudieron recorrer las empresas");
    } finally {
      timer = setTimeout(tick, TICK_MS);
      timer.unref();
    }
  };
  timer = setTimeout(tick, firstDelayMs);
  timer.unref();
}

// ------------------------------------------------------------------ Rutas

function providerOf(country: Country): RateProvider | null {
  return country.rateProvider ? (PROVIDERS[country.rateProvider] ?? null) : null;
}

export const ratesStatus = handler({}, async () => {
  const country = await currentCountry();
  const provider = providerOf(country);
  const token = provider?.needsToken
    ? await one<{ hint: string | null; updatedAt: string }>(
        `SELECT hint, updated_at AS "updatedAt" FROM company_secrets WHERE key = $1`,
        [BCCR_TOKEN]
      )
    : null;
  return {
    provider: provider ? { code: provider.code, name: provider.name, needsToken: provider.needsToken } : null,
    autoEnabled: Boolean(await settingValue("rates_auto_enabled", false)),
    intervalHours: Number(await settingValue("rates_interval_hours", 4)),
    bccrSide: provider?.code === "BCCR" ? await settingValue("rates_bccr_side", "sell") : null,
    token: provider?.needsToken ? { configured: Boolean(token), hint: token?.hint ?? null, updatedAt: token?.updatedAt ?? null } : null,
    runs: await query<RateRun>(`${RUN_SELECT} ORDER BY r.started_at DESC LIMIT 10`)
  };
});

const runBody = z
  .object({
    /** Solo fuera de producción: servidor simulado para las pruebas de humo */
    sourceUrl: z.url().optional()
  })
  .default({});

export const runRatesNow = handler({ body: runBody }, async ({ body, req }) => {
  if (body.sourceUrl && config.APP_ENVIRONMENT === "prod") throw badRequest("SOURCE_URL_FORBIDDEN", "No disponible en producción");
  return runRates("manual", authOf(req).userId, body.sourceUrl);
});

const tokenBody = z.object({ token: z.string().trim().min(20).max(4000) });

export const saveBccrToken = handler({ body: tokenBody }, async ({ body, req }) => {
  const provider = providerOf(await currentCountry());
  if (!provider?.needsToken) throw badRequest("TOKEN_NOT_NEEDED", "La fuente de tasas de este país no usa token");
  const token = body.token.replace(/^Bearer\s+/i, "");
  await withTx(txCtx(req), (client) =>
    client.query(
      `INSERT INTO company_secrets (key, ciphertext, hint, updated_by) VALUES ($1, $2, $3, fn_current_app_user())
       ON CONFLICT (company_id, key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint,
                                                   updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [BCCR_TOKEN, encryptSecret(token), `…${token.slice(-6)}`]
    )
  );
  return { configured: true, hint: `…${token.slice(-6)}` };
});

export const deleteBccrToken = handler({}, async ({ req }) => {
  await withTx(txCtx(req), (client) => client.query(`DELETE FROM company_secrets WHERE key = $1`, [BCCR_TOKEN]));
  return undefined;
});
