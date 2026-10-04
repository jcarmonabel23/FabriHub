/**
 * @project FabriHub - Front
 * @file src/global/utils/format.ts
 * @description Formatos de fecha y texto comunes
 */

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.locale("es");

export const fmtDateTime = (v: string | Date | null | undefined): string =>
  v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—";

export const fmtDateTimeSec = (v: string | Date | null | undefined): string =>
  v ? dayjs(v).format("DD/MM/YYYY HH:mm:ss") : "—";

export const fmtRelative = (v: string | Date | null | undefined): string => (v ? dayjs(v).fromNow() : "Nunca");

export const initials = (names: string): string =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const moneyFmt = new Map<number, Intl.NumberFormat>();

/** Monto con separadores venezolanos (1.234,56) */
export function fmtMoney(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!moneyFmt.has(decimals)) {
    moneyFmt.set(decimals, new Intl.NumberFormat("es-VE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  }
  return moneyFmt.get(decimals)!.format(v);
}

/** Porcentaje sin ceros sobrantes: 16 → "16%", 8.5 → "8,5%" */
export const fmtPct = (v: number): string => `${new Intl.NumberFormat("es-VE", { maximumFractionDigits: 4 }).format(v)}%`;

export const shortId =(id: string | null | undefined): string => (id ? id.slice(0, 8) : "—");
