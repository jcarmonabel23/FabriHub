/**
 * @project FabriHub - API
 * @file src/modules/admin/companies.ts
 * @description Empresas de la plataforma (módulo ADM_COMPANIES, alcance platform)
 *
 * @overview
 * Solo un administrador de plataforma ve este módulo (catalogs_modules.scope = 'platform').
 *   view       → listar empresas y sus miembros
 *   add_new    → crear empresa (sembrada con la configuración de otra) y su administrador inicial
 *   edit       → datos y suspensión
 *   configure  → agregar o retirar miembros
 * Los miembros se gestionan DENTRO de la empresa destino (withTx con su companyId), porque
 * sus permisos están aislados por RLS.
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, forbidden, handler, notFound } from "../../lib/http.js";
import { sendTemporaryPassword } from "../../lib/mailer.js";
import { authOf, txCtx } from "../../security/context.js";
import { addMember, removeMember, type AddedMember } from "./members.js";
import { companyBranding } from "../settings/branding.js";

export const COMPANIES_MODULE = "ADM_COMPANIES";

const SELECT = `SELECT c.id, c.code, c.legal_name AS "legalName", c.trade_name AS "tradeName", c.rif, c.is_active AS "isActive",
  c.city, c.country, c.email, c.base_currency_id AS "baseCurrencyId", cur.code AS "baseCurrencyCode", c.created_at AS "createdAt",
  (SELECT COUNT(*)::int FROM users_companies uc WHERE uc.company_id = c.id AND uc.is_active) AS "membersCount"
  FROM companies c JOIN catalogs_currencies cur ON cur.id = c.base_currency_id`;

export const listCompanies = handler({}, () => query(`${SELECT} ORDER BY c.code`));

async function companyDetail(id: string) {
  const company = await one(`${SELECT} WHERE c.id = $1`, [id]);
  if (!company) throw notFound("Empresa no encontrada");
  return company;
}

export const getCompanyAdmin = handler({ params: z.object({ id: z.uuid() }) }, ({ params }) => companyDetail(params.id));

// ------------------------------------------------------------------ Alta

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const companyFields = {
  legalName: z.string().trim().min(3).max(160),
  tradeName: optionalText(120),
  rif: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[VEJPG]-\d{8}-\d$/, "Formato de RIF: J-12345678-9"),
  city: optionalText(80),
  country: z.string().trim().min(2).max(80).default("Venezuela"),
  email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
  baseCurrencyId: z.uuid()
};

const createBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, "Código: 2 a 20 letras, números, - o _"),
  ...companyFields,
  /** Empresa de la que se copia la configuración base (por defecto, la activa) */
  templateCompanyId: z.uuid().optional(),
  /** Administrador inicial: un usuario existente o uno nuevo (con nombre) */
  admin: z
    .object({
      email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
      names: z.string().trim().min(3).max(120).optional()
    })
    .optional()
});

async function assertCurrency(id: string) {
  if (!(await one(`SELECT 1 FROM catalogs_currencies WHERE id = $1 AND is_active`, [id]))) {
    throw badRequest("INVALID_CURRENCY", "La moneda base debe existir y estar activa");
  }
}

async function notifyNewUser(m: AddedMember | null, companyId: string) {
  if (m?.tempPassword) await sendTemporaryPassword(m.email, m.names, m.tempPassword, await companyBranding(companyId));
}

export const createCompany = handler({ body: createBody }, async ({ body, req }) => {
  if (await one(`SELECT 1 FROM companies WHERE code = $1`, [body.code])) {
    throw conflict("CODE_TAKEN", "Ya existe una empresa con ese código");
  }
  await assertCurrency(body.baseCurrencyId);
  const template = body.templateCompanyId ?? authOf(req).companyId;
  if (!(await one(`SELECT 1 FROM companies WHERE id = $1`, [template]))) throw badRequest("INVALID_TEMPLATE", "Empresa plantilla inexistente");

  const companyId = await withTx(txCtx(req), async (client) => {
    const created = await one<{ id: string }>(
      `INSERT INTO companies (code, legal_name, trade_name, rif, city, country, email, base_currency_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
      [body.code, body.legalName, body.tradeName ?? null, body.rif, body.city ?? null, body.country, body.email ?? null, body.baseCurrencyId],
      client
    );
    await client.query(`SELECT fn_company_init($1, $2)`, [created!.id, template]);
    // Quien la crea queda como miembro administrador, para poder entrar a configurarla
    await client.query(`SELECT set_config('app.company_id', $1, true)`, [created!.id]);
    await addMember(client, { email: authOf(req).email, asAdmin: true });
    return created!.id;
  });

  let admin: AddedMember | null = null;
  if (body.admin && body.admin.email !== authOf(req).email.toLowerCase()) {
    admin = await withTx({ ...txCtx(req), companyId }, (client) =>
      addMember(client, { email: body.admin!.email, names: body.admin!.names, asAdmin: true })
    );
  }
  await notifyNewUser(admin, companyId);

  req.res?.status(201);
  return companyDetail(companyId);
});

// ------------------------------------------------------------------ Edición y suspensión

const updateBody = z
  .object({ ...companyFields, isActive: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nada que actualizar");

export const updateCompanyAdmin = handler(
  { params: z.object({ id: z.uuid() }), body: updateBody },
  async ({ params, body, req }) => {
    if (body.isActive === false && params.id === authOf(req).companyId) {
      throw forbidden("ACTIVE_COMPANY", "No puede suspender la empresa en la que está trabajando; cambie de empresa primero");
    }
    if (body.baseCurrencyId) await assertCurrency(body.baseCurrencyId);

    await withTx(txCtx(req), async (client) => {
      const row = await one(
        `UPDATE companies SET
                legal_name = COALESCE($2, legal_name), trade_name = CASE WHEN $3::boolean THEN $4 ELSE trade_name END,
                rif = COALESCE($5, rif), city = CASE WHEN $6::boolean THEN $7 ELSE city END,
                country = COALESCE($8, country), email = CASE WHEN $9::boolean THEN $10 ELSE email END,
                base_currency_id = COALESCE($11, base_currency_id), is_active = COALESCE($12, is_active),
                updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [
          params.id,
          body.legalName ?? null,
          "tradeName" in body,
          body.tradeName ?? null,
          body.rif ?? null,
          "city" in body,
          body.city ?? null,
          body.country ?? null,
          "email" in body,
          body.email ?? null,
          body.baseCurrencyId ?? null,
          body.isActive ?? null
        ],
        client
      );
      if (!row) throw notFound("Empresa no encontrada");
    });
    return companyDetail(params.id);
  }
);

// ------------------------------------------------------------------ Miembros

export const listMembers = handler({ params: z.object({ id: z.uuid() }) }, async ({ params }) => {
  await companyDetail(params.id);
  return query(
    `SELECT u.id, u.email, u.names, u.is_active AS "isActive", u.is_platform_admin AS "isPlatformAdmin",
            uc.is_default AS "isDefault", uc.created_at AS "memberSince"
       FROM users_companies uc JOIN users u ON u.id = uc.user_id
      WHERE uc.company_id = $1 AND uc.is_active
      ORDER BY u.names`,
    [params.id]
  );
});

const memberBody = z.object({
  email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
  names: z.string().trim().min(3).max(120).optional(),
  asAdmin: z.boolean().default(false)
});

export const addCompanyMember = handler(
  { params: z.object({ id: z.uuid() }), body: memberBody },
  async ({ params, body, req }) => {
    await companyDetail(params.id);
    const added = await withTx({ ...txCtx(req), companyId: params.id }, (client) => addMember(client, body));
    await notifyNewUser(added, params.id);
    req.res?.status(201);
    return { userId: added.userId, created: added.tempPassword !== null };
  }
);

export const removeCompanyMember = handler(
  { params: z.object({ id: z.uuid(), userId: z.uuid() }) },
  async ({ params, req }) => {
    if (params.userId === authOf(req).userId && params.id === authOf(req).companyId) {
      throw forbidden("SELF_LOCKOUT", "No puede retirarse de la empresa en la que está trabajando");
    }
    const removed = await withTx({ ...txCtx(req), companyId: params.id }, (client) => removeMember(client, params.userId));
    if (!removed) throw notFound("Ese usuario no pertenece a la empresa");
    return undefined;
  }
);
