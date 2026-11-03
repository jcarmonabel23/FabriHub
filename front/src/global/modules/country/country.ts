/**
 * @project FabriHub - Front
 * @file src/global/modules/country/country.ts
 * @description País de la empresa activa (fase 15) e identificación fiscal por país
 *
 *   const country = useCountry();          country.taxIdLabel → "RIF" | "Cédula"
 *   taxIdError(country, idType, valor)     null si es válida; si no, el mensaje
 *
 * La normalización repite la de la API (lib/taxId.ts) para validar mientras se escribe;
 * quien decide es la API (y el trigger fn_check_tax_id en la BD).
 */

import { coreAuth } from "@auth/store/coreAuth";
import type { CompanyCountry, IdType } from "@auth/types";

/** Respaldo mientras la sesión no trae el país (sesiones abiertas antes de la fase 15) */
const VENEZUELA: CompanyCountry = {
  code: "VE",
  name: "Venezuela",
  taxIdLabel: "RIF",
  timezone: "America/Caracas",
  currencyCode: "VES",
  idTypes: [
    { code: "RIF", name: "RIF", pattern: "^[VEJPG]-[0-9]{8}-[0-9]$", example: "J-12345678-9", juridical: true },
    { code: "CI", name: "Cédula de identidad", pattern: "^[VE]-[0-9]{5,9}$", example: "V-12345678", juridical: false }
  ],
  features: { igtf: true, withholdings: true, specialTaxpayer: true, eInvoice: false }
};

export function useCountry(): CompanyCountry {
  return coreAuth((s) => s.company?.country) ?? VENEZUELA;
}

/** Forma canónica según el país: «j123456789» → J-12345678-9 (VE); «3-101-123456» → 3101123456 (CR) */
export function canonicalTaxId(country: Pick<CompanyCountry, "code">, raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[\s.]/g, "");
  if (country.code === "VE") {
    const m = /^([VEJPG])-?(\d+)(?:-?(\d))?$/.exec(s);
    if (!m) return s;
    const [, kind, digits, check] = m;
    if (check !== undefined) return `${kind}-${digits}-${check}`;
    if (digits.length === 9) return `${kind}-${digits.slice(0, 8)}-${digits.slice(8)}`;
    return `${kind}-${digits}`;
  }
  return s.replace(/-/g, "");
}

/** Tipo que corresponde al número (el primero del país cuyo patrón coincide) */
export function detectIdType(country: Pick<CompanyCountry, "code" | "idTypes">, raw: string): IdType | null {
  const value = canonicalTaxId(country, raw);
  return country.idTypes.find((t) => !t.explicitOnly && new RegExp(t.pattern).test(value)) ?? null;
}

/** null si el número es válido para el tipo (o para alguno del país, sin tipo); si no, el mensaje */
export function taxIdError(country: Pick<CompanyCountry, "code" | "idTypes" | "name">, idType: string | null, raw: string): string | null {
  if (!raw.trim()) return null;
  const value = canonicalTaxId(country, raw);
  if (idType) {
    const t = country.idTypes.find((x) => x.code === idType);
    if (!t) return `Tipo no válido en ${country.name}`;
    return new RegExp(t.pattern).test(value) ? null : `${t.name}: ejemplo ${t.example}`;
  }
  return detectIdType(country, raw) ? null : `Identificación no válida en ${country.name}`;
}
