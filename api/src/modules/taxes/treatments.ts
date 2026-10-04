/**
 * @project FabriHub - API
 * @file src/modules/taxes/treatments.ts
 * @description Tratamientos fiscales (TAX_TREATMENTS) y simulador de cálculo
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { HttpError, badRequest, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";
import { computeTaxes, type Bracket, type WithholdingSpec } from "./engine.js";

const LIST = `SELECT f.id, f.code, f.name, f.description, f.is_active AS "isActive",
  to_char(f.valid_from, 'YYYY-MM-DD') AS "validFrom", to_char(f.valid_to, 'YYYY-MM-DD') AS "validTo",
  f.calc_method AS "calcMethod",
  f.tax_rate_id AS "taxRateId", t.code || ' · ' || tr.name AS "taxLabel", tr.rate::float AS "taxRate",
  f.withholding_rate_id AS "withholdingRateId",
  CASE WHEN wr.id IS NOT NULL THEN w.code || ' · ' || wr.name END AS "withholdingLabel",
  (f.is_active AND f.valid_from <= CURRENT_DATE AND (f.valid_to IS NULL OR f.valid_to >= CURRENT_DATE)) AS "isCurrent"
  FROM fiscal_treatments f
  JOIN taxes_rates tr ON tr.id = f.tax_rate_id
  JOIN taxes t ON t.id = tr.tax_id
  LEFT JOIN withholdings_rates wr ON wr.id = f.withholding_rate_id
  LEFT JOIN withholdings w ON w.id = wr.withholding_id`;

export const listTreatments = handler({}, () => query(`${LIST} ORDER BY f.order_list, f.code`));
const getTreatment = (id: string) => one(`${LIST} WHERE f.id = $1`, [id]);

/** Opciones para el formulario: solo tarifas activas de impuestos/retenciones activos */
export const treatmentOptions = handler({}, async () => {
  const [taxRates, withholdingRates] = await Promise.all([
    query(
      `SELECT tr.id AS value, t.code || ' · ' || tr.name || ' (' || trim_scale(tr.rate) || '%)' AS label
         FROM taxes_rates tr JOIN taxes t ON t.id = tr.tax_id
        WHERE tr.is_active AND t.is_active ORDER BY t.order_list, tr.order_list`
    ),
    query(
      `SELECT wr.id AS value, w.code || ' · ' || wr.name AS label
         FROM withholdings_rates wr JOIN withholdings w ON w.id = wr.withholding_id
        WHERE wr.is_active AND w.is_active ORDER BY w.order_list, wr.order_list`
    )
  ]);
  return { taxRates, withholdingRates };
});

const dateStr = z.iso.date();
const fields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullish(),
  validFrom: dateStr,
  validTo: dateStr.nullish(),
  taxRateId: z.uuid(),
  withholdingRateId: z.uuid().nullish(),
  calcMethod: z.enum(["product", "party", "both"])
};

const checkDates = (from?: string, to?: string | null) => {
  if (from && to && to < from) throw badRequest("INVALID_VALIDITY", "La fecha fin no puede ser anterior a la de inicio");
};

export const createTreatment = handler(
  {
    body: z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{1,20}$/, "Solo mayúsculas, números, - y _ (máx. 20)"),
      ...fields
    })
  },
  async ({ body: b, req, res }) => {
    checkDates(b.validFrom, b.validTo);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO fiscal_treatments (code, name, description, valid_from, valid_to, tax_rate_id, withholding_rate_id,
                                        calc_method, order_list, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(MAX(order_list), 0) + 1 FROM fiscal_treatments),
                 fn_current_app_user(), fn_current_app_user())
         RETURNING id`,
        [b.code, b.name, b.description ?? null, b.validFrom, b.validTo ?? null, b.taxRateId, b.withholdingRateId ?? null, b.calcMethod],
        client
      )
    );
    res.status(201);
    return getTreatment(row!.id);
  }
);

export const updateTreatment = handler(
  {
    params: idParams,
    body: z.object({ ...fields, isActive: z.boolean() }).partial().refine((b) => Object.keys(b).length > 0, "Nada que actualizar")
  },
  async ({ params, body: b, req }) => {
    const current = await one<{ valid_from: string; valid_to: string | null }>(
      `SELECT to_char(valid_from,'YYYY-MM-DD') AS valid_from, to_char(valid_to,'YYYY-MM-DD') AS valid_to
         FROM fiscal_treatments WHERE id = $1`,
      [params.id]
    );
    if (!current) throw notFound();
    checkDates(b.validFrom ?? current.valid_from, b.validTo === undefined ? current.valid_to : b.validTo);

    await withTx(txCtx(req), (client) =>
      client.query(
        `UPDATE fiscal_treatments SET
            name = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            valid_from = COALESCE($5::date, valid_from),
            valid_to = CASE WHEN $6::boolean THEN $7::date ELSE valid_to END,
            tax_rate_id = COALESCE($8, tax_rate_id),
            withholding_rate_id = CASE WHEN $9::boolean THEN $10::uuid ELSE withholding_rate_id END,
            calc_method = COALESCE($11, calc_method),
            is_active = COALESCE($12, is_active),
            updated_by = fn_current_app_user()
          WHERE id = $1`,
        [
          params.id,
          b.name ?? null,
          b.description !== undefined,
          b.description ?? null,
          b.validFrom ?? null,
          b.validTo !== undefined,
          b.validTo ?? null,
          b.taxRateId ?? null,
          b.withholdingRateId !== undefined,
          b.withholdingRateId ?? null,
          b.calcMethod ?? null,
          b.isActive ?? null
        ]
      )
    );
    return getTreatment(params.id);
  }
);

export const deleteTreatment = handler({ params: idParams }, async ({ params, req }) => {
  const row = await withTx(txCtx(req), (client) =>
    one(`DELETE FROM fiscal_treatments WHERE id = $1 RETURNING id`, [params.id], client)
  );
  if (!row) throw notFound();
  return undefined;
});

// ------------------------------------------------------------------ Cálculo

interface CalcRow {
  code: string;
  name: string;
  tax_rate: number;
  base_on: "amount" | "tax" | null;
  brackets: Bracket[] | null;
  valid: boolean;
}

/**
 * @function loadTreatmentForCalc
 * @description Carga lo necesario para calcular. Rechaza tratamientos inactivos o fuera de vigencia
 * en la fecha del documento. La usarán las órdenes de compra y venta.
 */
export async function loadTreatmentForCalc(id: string, date: string) {
  const row = await one<CalcRow>(
    `SELECT f.code, f.name, tr.rate::float AS tax_rate, w.base_on,
            (SELECT jsonb_agg(jsonb_build_object('fromAmount', b.from_amount::float, 'rate', b.rate::float,
                                                 'subtrahend', b.subtrahend::float))
               FROM withholdings_brackets b WHERE b.withholding_rate_id = wr.id) AS brackets,
            (f.is_active AND tr.is_active AND f.valid_from <= $2::date AND (f.valid_to IS NULL OR f.valid_to >= $2::date)
             AND (wr.id IS NULL OR wr.is_active)) AS valid
       FROM fiscal_treatments f
       JOIN taxes_rates tr ON tr.id = f.tax_rate_id
       LEFT JOIN withholdings_rates wr ON wr.id = f.withholding_rate_id
       LEFT JOIN withholdings w ON w.id = wr.withholding_id
      WHERE f.id = $1`,
    [id, date]
  );
  if (!row) throw notFound("Tratamiento fiscal no encontrado");
  if (!row.valid) {
    throw new HttpError(409, "TREATMENT_NOT_VALID", `El tratamiento ${row.code} no está activo o vigente el ${date}`);
  }
  const withholding: WithholdingSpec | null =
    row.base_on && row.brackets ? { baseOn: row.base_on, brackets: row.brackets } : null;
  return { code: row.code, name: row.name, taxRate: row.tax_rate, withholding };
}

export const simulateTreatment = handler(
  {
    params: idParams,
    body: z.object({ amount: z.number().min(0).max(1e13), date: z.iso.date().optional() })
  },
  async ({ params, body }) => {
    // Sin fecha: "hoy" según la BD (zona de la empresa); toISOString() daría el día UTC.
    const date = body.date ?? (await one<{ d: string }>(`SELECT CURRENT_DATE::text AS d`))!.d;
    const t = await loadTreatmentForCalc(params.id, date);
    return { treatment: { code: t.code, name: t.name }, date, ...computeTaxes(body.amount, t.taxRate, t.withholding) };
  }
);
