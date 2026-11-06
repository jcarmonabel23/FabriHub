/**
 * @project FabriHub - Front
 * @file src/app/dashboard/reports/format.ts
 * @description Formato de los valores de un reporte según su tipo (celdas, indicadores y gráficos)
 */

import dayjs from "dayjs";
import { fmtMoney } from "@utils/format";
import { fmtCur } from "@utils/money";
import type { ReportValueType } from "../dashboard.service";

const QC_LABEL: Record<string, string> = { quarantine: "Cuarentena", approved: "Aprobado", rejected: "Rechazado", on_hold: "Retenido" };

const qtyFmt = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 });
const compactFmt = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });

/** Un valor con su formato; `currency` solo aplica a montos */
export function fmtValue(type: ReportValueType, v: unknown, currency?: string, key?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "int":
      return fmtMoney(Number(v), 0);
    case "qty":
      return qtyFmt.format(Number(v));
    case "money":
      return fmtCur(Number(v), currency);
    case "pct":
      return `${fmtMoney(Number(v) * 100, 1)} %`;
    case "date":
      return dayjs(String(v)).format("DD/MM/YYYY");
    case "datetime":
      return dayjs(String(v)).format("DD/MM/YYYY HH:mm");
    default:
      return key === "qualityStatus" ? (QC_LABEL[String(v)] ?? String(v)) : String(v);
  }
}

/** Marcas de los ejes: números cortos (1,2 mil; 3,4 M) y porcentajes */
export function fmtAxis(type: ReportValueType, v: number): string {
  if (type === "pct") return `${Math.round(v * 100)} %`;
  return compactFmt.format(v);
}
