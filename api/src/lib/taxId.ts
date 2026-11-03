/**
 * @project FabriHub - API
 * @file src/lib/taxId.ts
 * @description País de la empresa activa e identificación fiscal (RIF, cédula, DIMEX…) por país
 *
 * @overview
 * La configuración de cada país vive en catalogs_countries (fase 15). Aquí se lee (con caché corta),
 * se normaliza lo que escribe el usuario («j123456789» → J-12345678-9, «3-101-123456» → 3101123456)
 * y se valida contra el patrón del tipo. El trigger fn_check_tax_id repite la validación en la BD.
 */

import { one, query } from "../db.js";
import { badRequest } from "./http.js";

export interface IdType {
  code: string;
  name: string;
  pattern: string;
  example: string;
  juridical: boolean;
  /** Solo si se elige el tipo: su patrón es tan amplio que no se deduce del formato (extranjero en CR) */
  explicitOnly?: boolean;
}

export interface Country {
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
  taxIdLabel: string;
  idTypes: IdType[];
  features: { igtf?: boolean; withholdings?: boolean; specialTaxpayer?: boolean; eInvoice?: boolean; fiscalDoc?: boolean };
  /** Fuente oficial de la tasa de cambio (fase 16); null = solo carga manual */
  rateProvider: "BCV" | "BCCR" | null;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; byCode: Map<string, Country> } | null = null;

export async function countries(): Promise<Country[]> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const rows = await query<Country>(
      `SELECT code, name, currency_code AS "currencyCode", timezone, tax_id_label AS "taxIdLabel",
              id_types AS "idTypes", features, rate_provider AS "rateProvider"
         FROM catalogs_countries WHERE is_active ORDER BY order_list, name`
    );
    cache = { at: Date.now(), byCode: new Map(rows.map((c) => [c.code.trim(), { ...c, code: c.code.trim() }])) };
  }
  return [...cache.byCode.values()];
}

export async function countryByCode(code: string): Promise<Country> {
  await countries();
  const c = cache!.byCode.get(code);
  if (!c) throw badRequest("INVALID_COUNTRY", `País no disponible: ${code}`);
  return c;
}

/** País de la empresa activa (la del contexto: runInCompany / sesión) */
export async function currentCountry(): Promise<Country> {
  const row = await one<{ code: string }>(`SELECT fn_current_country() AS code`);
  if (!row?.code) throw badRequest("NO_COMPANY", "No hay una empresa activa");
  return countryByCode(row.code.trim());
}

/** Forma canónica según el país (sin validar todavía el tipo) */
function canonical(country: string, raw: string): string {
  const s = raw.toUpperCase().replace(/[\s.]/g, "");
  if (country === "VE") {
    const m = /^([VEJPG])-?(\d+)(?:-?(\d))?$/.exec(s);
    if (!m) return s;
    const [, kind, digits, check] = m;
    if (check !== undefined) return `${kind}-${digits}-${check}`;
    if (digits.length === 9) return `${kind}-${digits.slice(0, 8)}-${digits.slice(8)}`;
    return `${kind}-${digits}`;
  }
  // Costa Rica y demás: Hacienda usa solo dígitos (o letras y dígitos para extranjeros)
  return s.replace(/-/g, "");
}

/**
 * @function normalizeTaxId
 * @description Normaliza y valida un número de identificación. Sin tipo, lo deduce del formato
 * (el primer tipo del país cuyo patrón coincida). Lanza 400 INVALID_TAX_ID si no cumple.
 */
export function normalizeTaxId(country: Country, raw: string, idType?: string | null): { idType: string; value: string } {
  const value = canonical(country.code, raw.trim());
  if (idType) {
    const t = country.idTypes.find((x) => x.code === idType);
    if (!t) throw badRequest("INVALID_ID_TYPE", `El tipo de identificación ${idType} no existe en ${country.name}`);
    if (!new RegExp(t.pattern).test(value)) {
      throw badRequest("INVALID_TAX_ID", `${t.name} inválida: ${raw.trim()} (ejemplo: ${t.example})`);
    }
    return { idType: t.code, value };
  }
  const t = country.idTypes.find((x) => !x.explicitOnly && new RegExp(x.pattern).test(value));
  if (!t) {
    const examples = country.idTypes.map((x) => `${x.name} ${x.example}`).join(", ");
    throw badRequest("INVALID_TAX_ID", `Identificación inválida para ${country.name}: ${raw.trim()} (ej.: ${examples})`);
  }
  return { idType: t.code, value };
}

/** Variante que no lanza (búsquedas): null si no es una identificación válida */
export function tryNormalizeTaxId(country: Country, raw: string): string | null {
  try {
    return normalizeTaxId(country, raw).value;
  } catch {
    return null;
  }
}
