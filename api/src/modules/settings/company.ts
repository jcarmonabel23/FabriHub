/**
 * @project FabriHub - API
 * @file src/modules/settings/company.ts
 * @description Datos de la empresa (SET_COMPANY): fila única
 */

import { z } from "zod";
import { one, withTx } from "../../db.js";
import { badRequest, handler } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

const SELECT = `SELECT c.legal_name AS "legalName", c.trade_name AS "tradeName", c.rif, c.address, c.city, c.state,
  c.country, c.phones, c.email, c.website, c.base_currency_id AS "baseCurrencyId", cur.code AS "baseCurrencyCode",
  c.is_special_taxpayer AS "isSpecialTaxpayer", c.is_withholding_agent AS "isWithholdingAgent",
  c.fiscal_year_start_month AS "fiscalYearStartMonth", c.updated_at AS "updatedAt"
  FROM company c JOIN catalogs_currencies cur ON cur.id = c.base_currency_id WHERE c.id = 1`;

export const getCompany = handler({}, () => one(SELECT));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const body = z.object({
  legalName: z.string().trim().min(3).max(160),
  tradeName: optionalText(120),
  rif: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[VEJPG]-\d{8}-\d$/, "Formato de RIF: J-12345678-9"),
  address: optionalText(400),
  city: optionalText(80),
  state: optionalText(80),
  country: z.string().trim().min(2).max(80),
  phones: z.array(z.string().trim().regex(/^[0-9+()\s-]{7,20}$/, "Teléfono inválido")).max(3),
  email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
  website: optionalText(200),
  baseCurrencyId: z.uuid(),
  isSpecialTaxpayer: z.boolean(),
  isWithholdingAgent: z.boolean(),
  fiscalYearStartMonth: z.number().int().min(1).max(12)
});

export const updateCompany = handler({ body }, async ({ body: b, req }) => {
  const currency = await one(`SELECT 1 FROM catalogs_currencies WHERE id = $1 AND is_active`, [b.baseCurrencyId]);
  if (!currency) throw badRequest("INVALID_CURRENCY", "La moneda base debe existir y estar activa");

  await withTx(txCtx(req), (client) =>
    client.query(
      `UPDATE company SET legal_name = $1, trade_name = $2, rif = $3, address = $4, city = $5, state = $6,
              country = $7, phones = $8, email = $9, website = $10, base_currency_id = $11,
              is_special_taxpayer = $12, is_withholding_agent = $13, fiscal_year_start_month = $14,
              updated_by = fn_current_app_user()
        WHERE id = 1`,
      [
        b.legalName,
        b.tradeName ?? null,
        b.rif,
        b.address ?? null,
        b.city ?? null,
        b.state ?? null,
        b.country,
        JSON.stringify(b.phones),
        b.email ?? null,
        b.website ?? null,
        b.baseCurrencyId,
        b.isSpecialTaxpayer,
        b.isWithholdingAgent,
        b.fiscalYearStartMonth
      ]
    )
  );
  return one(SELECT);
});
