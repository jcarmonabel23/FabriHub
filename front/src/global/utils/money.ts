/**
 * @project FabriHub - Front
 * @file src/global/utils/money.ts
 * @description Montos con su moneda (código ISO delante): «VES 1.234,56», «USD 10,00»
 *
 * fmtCur para montos de un documento en su moneda (OC, OV, despachos, ventas POS); fmtBase para
 * costos, valores de inventario y producción, que siempre están en la moneda base de la empresa.
 */

import { coreAuth } from "@auth/store/coreAuth";
import { fmtMoney } from "./format";

/** Monto precedido por el código de su moneda; sin código, solo el número */
export function fmtCur(v: number | null | undefined, code: string | null | undefined, decimals = 2): string {
  const amount = fmtMoney(v, decimals);
  return amount === "—" || !code ? amount : `${code.trim()} ${amount}`;
}

/** Código ISO de la moneda base de la empresa activa */
export const baseCurrency = (): string => coreAuth.getState().company?.baseCurrencyCode ?? "";

/** Monto en la moneda base de la empresa activa */
export const fmtBase = (v: number | null | undefined, decimals = 2): string => fmtCur(v, baseCurrency(), decimals);
