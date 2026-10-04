/**
 * @project FabriHub - API
 * @file src/modules/settings/parameters.ts
 * @description Parámetros por módulo y correlativos de documentos (SET_PARAMETERS)
 *
 * @overview
 * Las definiciones las fija el código (00203_parameters.sql); aquí solo se cambia el VALOR,
 * validado contra su tipo y reglas. Los correlativos nunca retroceden: bajar el próximo
 * número podría repetir números de documentos ya emitidos.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, handler, idParams, notFound } from "../../lib/http.js";
import { txCtx } from "../../security/context.js";

interface ParameterRow {
  id: string;
  moduleCode: string;
  moduleName: string;
  key: string;
  name: string;
  description: string | null;
  dataType: "string" | "integer" | "number" | "boolean" | "select";
  value: unknown;
  defaultValue: unknown;
  rules: { min?: number; max?: number; maxLength?: number; options?: { value: string; label: string }[] };
  updatedAt: string;
  updatedBy: string | null;
}

const SELECT = `SELECT p.id, p.module_code AS "moduleCode", m.name AS "moduleName", p.key, p.name, p.description,
  p.data_type AS "dataType", p.value, p.default_value AS "defaultValue", p.rules, p.updated_at AS "updatedAt",
  u.names AS "updatedBy"
  FROM parameters p JOIN catalogs_modules m ON m.code = p.module_code LEFT JOIN users u ON u.id = p.updated_by`;

export const listParameters = handler({}, () => query<ParameterRow>(`${SELECT} ORDER BY m.order_list, p.order_list`));

/** Valida un valor contra la definición del parámetro; devuelve el valor normalizado */
export function validateParameterValue(p: Pick<ParameterRow, "dataType" | "rules" | "name">, value: unknown): unknown {
  const r = p.rules ?? {};
  let schema: z.ZodType;
  switch (p.dataType) {
    case "boolean":
      schema = z.boolean();
      break;
    case "integer":
      schema = z
        .number()
        .int()
        .min(r.min ?? Number.MIN_SAFE_INTEGER)
        .max(r.max ?? Number.MAX_SAFE_INTEGER);
      break;
    case "number":
      schema = z
        .number()
        .min(r.min ?? -1e15)
        .max(r.max ?? 1e15);
      break;
    case "select":
      schema = z.enum((r.options ?? []).map((o) => o.value) as [string, ...string[]]);
      break;
    default:
      schema = z.string().trim().max(r.maxLength ?? 400);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("INVALID_PARAMETER_VALUE", `Valor inválido para «${p.name}»`, parsed.error.issues.map((i) => i.message));
  }
  return parsed.data;
}

async function setValue(id: string, value: unknown, req: Parameters<typeof txCtx>[0]) {
  await withTx(txCtx(req), (client) =>
    client.query(`UPDATE parameters SET value = $2, updated_by = fn_current_app_user() WHERE id = $1`, [
      id,
      JSON.stringify(value)
    ])
  );
  return one<ParameterRow>(`${SELECT} WHERE p.id = $1`, [id]);
}

export const updateParameter = handler(
  { params: idParams, body: z.object({ value: z.unknown() }) },
  async ({ params, body, req }) => {
    const p = await one<ParameterRow>(`${SELECT} WHERE p.id = $1`, [params.id]);
    if (!p) throw notFound("Parámetro no encontrado");
    return setValue(params.id, validateParameterValue(p, body.value), req);
  }
);

export const resetParameter = handler({ params: idParams }, async ({ params, req }) => {
  const p = await one<ParameterRow>(`${SELECT} WHERE p.id = $1`, [params.id]);
  if (!p) throw notFound("Parámetro no encontrado");
  return setValue(params.id, p.defaultValue, req);
});

// ------------------------------------------------------------------ Correlativos

const SEQ_SELECT = `SELECT s.doc_type AS "docType", s.name, s.module_code AS "moduleCode", m.name AS "moduleName",
  s.prefix, s.padding, s.next_number::int AS "nextNumber",
  s.prefix || lpad(s.next_number::text, s.padding, '0') AS preview, s.updated_at AS "updatedAt"
  FROM document_sequences s JOIN catalogs_modules m ON m.code = s.module_code`;

export const listSequences = handler({}, () => query(`${SEQ_SELECT} ORDER BY m.order_list, s.doc_type`));

const seqBody = z
  .object({
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{0,10}$/, "Solo mayúsculas, números y guiones (máx. 10)")
      .optional(),
    padding: z.number().int().min(1).max(12).optional(),
    nextNumber: z.number().int().min(1).optional()
  })
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

export const updateSequence = handler(
  { params: z.object({ docType: z.string().regex(/^[A-Z]+$/) }), body: seqBody },
  async ({ params, body, req }) => {
    const seq = await withTx(txCtx(req), async (client) => {
      const current = await one<{ next_number: string }>(
        `SELECT next_number FROM document_sequences WHERE doc_type = $1 FOR UPDATE`,
        [params.docType],
        client
      );
      if (!current) throw notFound("Correlativo no encontrado");
      if (body.nextNumber !== undefined && body.nextNumber < Number(current.next_number)) {
        throw badRequest("SEQUENCE_BACKWARDS", "El próximo número no puede ser menor al actual: repetiría documentos");
      }
      await client.query(
        `UPDATE document_sequences
            SET prefix = COALESCE($2, prefix), padding = COALESCE($3, padding),
                next_number = COALESCE($4, next_number), updated_by = fn_current_app_user()
          WHERE doc_type = $1`,
        [params.docType, body.prefix ?? null, body.padding ?? null, body.nextNumber ?? null]
      );
      return one(`${SEQ_SELECT} WHERE s.doc_type = $1`, [params.docType], client);
    });
    return seq;
  }
);
