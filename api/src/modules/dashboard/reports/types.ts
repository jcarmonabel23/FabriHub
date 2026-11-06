/**
 * @project FabriHub - API
 * @file src/modules/dashboard/reports/types.ts
 * @description Definición de un reporte del Tablero y utilidades para su resumen (indicadores y gráficos)
 *
 * @overview
 * Un reporte entrega filas (detalle, la hoja del Excel) y, opcionalmente, indicadores y gráficos que se
 * calculan sobre esas mismas filas. Con rango de fechas, los indicadores se comparan con el período
 * anterior (ver previousRange). Las filas pueden traer `_usd`: unidades de moneda base por dólar de su
 * fecha (fn_rate_on), con lo que los montos se expresan también en dólares con la tasa de cada día.
 * Las claves que empiezan con «_» son internas: no van al Excel.
 */

import type { ModuleAccess } from "../access.js";

export type ColType = "text" | "int" | "qty" | "money" | "pct" | "date" | "datetime";

export interface Column {
  key: string;
  header: string;
  type: ColType;
  width?: number;
  /** Suma la columna en la fila de totales */
  total?: boolean;
  /** Montos: columna de la fila con su moneda; sin ella, están en la moneda base */
  currencyKey?: string;
  /** Equivalente en dólares: la columna se omite si la moneda base ya es el dólar */
  usd?: boolean;
  /** Montos siempre en esta moneda (p. ej., USD al comparar empresas con distinta moneda base) */
  currency?: string;
}

export interface Ctx {
  userId: string;
  access: ModuleAccess;
  from: string;
  to: string;
  /** Código ISO de la moneda base de la empresa activa */
  base: string;
}

export type Row = Record<string, unknown>;

export interface KpiDef {
  key: string;
  label: string;
  type: ColType;
  value: (rows: Row[], ctx: Ctx) => number | string | null;
  /** Equivalente en dólares (solo montos) */
  usd?: (rows: Row[], ctx: Ctx) => number | null;
  /** Moneda del monto si no es la base */
  currency?: string;
  /** Qué dirección es buena al comparar con el período anterior */
  better?: "up" | "down";
  /** Explicación breve de cómo se calcula */
  help?: string;
}

export interface ChartPoint {
  label: string;
  [key: string]: string | number | null;
}

export interface ChartDef {
  title: string;
  /** bar: categorías (ranking o reparto); line: evolución por fecha; donut: participación;
   * heatmap: matriz (una fila por punto, una columna por serie), intensidad según el valor */
  kind: "bar" | "line" | "donut" | "heatmap";
  /** Tipo de los valores (para formatearlos) */
  type: ColType;
  series: { key: string; label: string }[];
  /** Barras horizontales: rankings con etiquetas largas */
  horizontal?: boolean;
  /** Moneda de los montos si no es la base */
  currency?: string;
  data: (rows: Row[], ctx: Ctx) => ChartPoint[];
}

export const REPORT_GROUPS = ["Gerencial", "Ventas", "Caja", "Inventario", "Compras", "Producción", "Fiscal y tesorería", "Tablero"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export interface ReportDef {
  code: string;
  name: string;
  description: string;
  /** Área del menú de reportes */
  group: ReportGroup;
  /** Solo para empresas de estos países (p. ej., comprobantes electrónicos de Costa Rica) */
  countries?: string[];
  /** Solo si la moneda base NO es el dólar (p. ej., el diferencial cambiario) */
  foreignBaseOnly?: boolean;
  /** Módulo(s) de origen: basta con poder ver uno */
  module: string | string[];
  /** El reporte filtra por rango de fechas */
  ranged: boolean;
  /** Días del rango por defecto (30 si no se indica) */
  defaultDays?: number;
  /** Compara los indicadores con el período anterior (por defecto, si tiene rango) */
  compare?: boolean;
  columns: Column[];
  rows: (ctx: Ctx) => Promise<Row[]>;
  kpis?: KpiDef[];
  charts?: ChartDef[];
}

// ------------------------------------------------------------------ Utilidades de cálculo

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

export const sum = (rows: Row[], key: string): number => rows.reduce((s, r) => s + num(r[key]), 0);

/** Suma en dólares: cada fila con su tasa del día (`_usd`); null si ninguna fila tiene tasa */
export function sumUsd(rows: Row[], key: string): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const rate = Number(r._usd);
    if (!rate) continue;
    any = true;
    total += num(r[key]) / rate;
  }
  return any ? total : null;
}

export const distinct = (rows: Row[], key: string): number => new Set(rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)).size;

export const ratio = (a: number, b: number): number | null => (b ? a / b : null);

/** Variación relativa; null si no hay base para comparar */
export const pctChange = (now: number, before: number): number | null => (before ? (now - before) / Math.abs(before) : null);

/** Monto en dólares con la tasa (unidades de moneda base por dólar); null sin tasa */
export const usdOf = (amount: number, rate: unknown): number | null => (Number(rate) ? amount / Number(rate) : null);

/** dd/mm de una fecha ISO, para los ejes */
export const ddmm = (iso: unknown): string => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;

/** Agrupa y suma: una fila del gráfico por valor de `by` */
export function groupSum(
  rows: Row[],
  by: string | ((r: Row) => string),
  keys: string[],
  opts: { top?: number; sortBy?: string; asc?: boolean; order?: string[] } = {}
): ChartPoint[] {
  const label = typeof by === "string" ? (r: Row) => String(r[by] ?? "Sin dato") : by;
  const acc = new Map<string, ChartPoint>();
  for (const r of rows) {
    const l = label(r);
    const p = acc.get(l) ?? { label: l, ...Object.fromEntries(keys.map((k) => [k, 0])) };
    for (const k of keys) p[k] = num(p[k]) + num(r[k]);
    acc.set(l, p);
  }
  let out = [...acc.values()];
  if (opts.order) out = opts.order.map((l) => acc.get(l) ?? { label: l, ...Object.fromEntries(keys.map((k) => [k, 0])) });
  const s = opts.sortBy;
  if (s) out.sort((a, b) => (opts.asc ? num(a[s]) - num(b[s]) : num(b[s]) - num(a[s])));
  for (const p of out) for (const k of keys) p[k] = Math.round(num(p[k]) * 100) / 100;
  return opts.top ? out.slice(0, opts.top) : out;
}

/** Días entre dos fechas ISO, ambos incluidos */
export const daysIn = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export const shiftIso = (iso: string, days: number): string => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Período con el que se compara: los mismos días de la semana anterior si el rango tiene menos de
 * una semana (un día se compara con el mismo día de la semana pasada); si no, el período de igual
 * duración inmediatamente anterior.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysIn(from, to);
  const shift = len < 7 ? 7 : len;
  return { from: shiftIso(from, -shift), to: shiftIso(to, -shift) };
}

/** Fechas ISO del rango, una por día */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftIso(d, 1)) out.push(d);
  return out;
}

export const WEEKDAY = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const weekday = (iso: string): string => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];
