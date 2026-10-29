/**
 * @project FabriHub - API
 * @file src/modules/settings/branding.ts
 * @description Identidad de la empresa (SET_COMPANY): logo, ícono y color; y su lectura para documentos y correos
 *
 * @overview
 * El logo y el ícono se suben como subrecursos de la empresa activa (PUT/DELETE /settings/company/logo|icon).
 * companyBranding() reúne lo que necesitan Excel, PDF y correos: datos fiscales, color y el logo en PNG
 * (Excel y PDF no admiten WebP). companies es global, así que se puede leer sin empresa activa
 * (correo de OTP) y el logo se ubica por su clave <empresa>/<archivo>, sin consultar files.
 */

import sharp from "sharp";
import { one, withTx } from "../../db.js";
import { handler, notFound } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { storage } from "../../lib/storage.js";
import { authOf, txCtx } from "../../security/context.js";
import {
  fileKey,
  iconUrls,
  insertFileRow,
  logoUrls,
  originalName,
  removeStored,
  storeImage,
  type FilePurpose,
  type ImageProfile
} from "../files/images.js";

/** Color de FabriHub cuando la empresa no definió el suyo */
export const DEFAULT_BRAND = "#167c94";

export interface Branding {
  companyId: string;
  name: string;
  legalName: string;
  rif: string;
  address: string | null;
  city: string | null;
  phones: string[];
  email: string | null;
  brandColor: string;
  /** Logo en PNG para documentos y correos, con su tamaño en px */
  logo: { png: Buffer; width: number; height: number } | null;
}

/**
 * @function companyBranding
 * @description Identidad de una empresa para documentos y correos. Nunca lanza: sin logo legible, logo = null.
 */
export async function companyBranding(companyId: string): Promise<Branding | null> {
  const c = await one<{
    id: string;
    name: string;
    legal_name: string;
    rif: string;
    address: string | null;
    city: string | null;
    phones: string[] | null;
    email: string | null;
    brand_color: string | null;
    logo_file_id: string | null;
  }>(
    `SELECT id, COALESCE(trade_name, legal_name) AS name, legal_name, rif, address, city, phones, email,
            brand_color, logo_file_id
       FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!c) return null;

  let logo: Branding["logo"] = null;
  const key = fileKey(c.id, c.logo_file_id);
  if (key) {
    try {
      const png = await storage.get(`${key}/doc.png`);
      if (png) {
        const meta = await sharp(png).metadata();
        logo = { png, width: meta.width ?? 1, height: meta.height ?? 1 };
      }
    } catch (err) {
      logger.warn({ err, companyId }, "[branding] no se pudo leer el logo");
    }
  }
  return {
    companyId: c.id,
    name: c.name,
    legalName: c.legal_name,
    rif: c.rif,
    address: c.address,
    city: c.city,
    phones: c.phones ?? [],
    email: c.email,
    brandColor: c.brand_color ?? DEFAULT_BRAND,
    logo
  };
}

/** Identidad de la empresa por defecto de un usuario (correos fuera de una sesión, como el OTP) */
export async function brandingForUser(userId: string): Promise<Branding | null> {
  const row = await one<{ company_id: string }>(
    `SELECT uc.company_id FROM users_companies uc JOIN companies c ON c.id = uc.company_id AND c.is_active
      WHERE uc.user_id = $1 AND uc.is_active
      ORDER BY uc.is_default DESC, uc.created_at LIMIT 1`,
    [userId]
  );
  return row ? companyBranding(row.company_id) : null;
}

/** Datos de identidad para la sesión y la pantalla Empresa (URLs firmadas) */
export function brandingUrls(c: { id: string; logo_file_id: string | null; icon_file_id: string | null; brand_color: string | null }) {
  return {
    brandColor: c.brand_color,
    logo: logoUrls(fileKey(c.id, c.logo_file_id)),
    icon: iconUrls(fileKey(c.id, c.icon_file_id))
  };
}

// ------------------------------------------------------------------ Subida de logo e ícono

const KINDS = {
  logo: { column: "logo_file_id", purpose: "company_logo", profile: "logo" },
  icon: { column: "icon_file_id", purpose: "company_icon", profile: "icon" }
} as const satisfies Record<string, { column: string; purpose: FilePurpose; profile: ImageProfile }>;

async function currentBranding(companyId: string) {
  const c = await one<{ id: string; logo_file_id: string | null; icon_file_id: string | null; brand_color: string | null }>(
    `SELECT id, logo_file_id, icon_file_id, brand_color FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!c) throw notFound("Empresa no encontrada");
  return brandingUrls(c);
}

/** PUT /settings/company/logo|icon — cuerpo crudo (PNG/JPG/WebP); reemplaza el anterior */
export const setCompanyImage = (kind: keyof typeof KINDS) =>
  handler({}, async ({ req }) => {
    const { column, purpose, profile } = KINDS[kind];
    const companyId = authOf(req).companyId;
    const body = req.body as unknown;
    const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);

    const stored = await storeImage(buf, companyId, profile);
    let previous: string | null;
    try {
      previous = await withTx(txCtx(req), async (client) => {
        const current = await one<{ file_id: string | null }>(
          `SELECT ${column} AS file_id FROM companies WHERE id = fn_current_company() FOR UPDATE`,
          [],
          client
        );
        await insertFileRow(client, stored, {
          purpose,
          originalName: originalName(req),
          originalMime: req.header("content-type") ?? "application/octet-stream",
          originalBytes: buf.length
        });
        await client.query(`UPDATE companies SET ${column} = $1, updated_by = fn_current_app_user() WHERE id = fn_current_company()`, [
          stored.id
        ]);
        return dropFile(client, current?.file_id ?? null);
      });
    } catch (err) {
      await removeStored(stored.storageKey);
      throw err;
    }
    await removeStored(previous);
    return currentBranding(companyId);
  });

export const removeCompanyImage = (kind: keyof typeof KINDS) =>
  handler({}, async ({ req }) => {
    const { column } = KINDS[kind];
    const key = await withTx(txCtx(req), async (client) => {
      const current = await one<{ file_id: string | null }>(
        `SELECT ${column} AS file_id FROM companies WHERE id = fn_current_company() FOR UPDATE`,
        [],
        client
      );
      await client.query(`UPDATE companies SET ${column} = NULL, updated_by = fn_current_app_user() WHERE id = fn_current_company()`);
      return dropFile(client, current?.file_id ?? null);
    });
    await removeStored(key);
    return currentBranding(authOf(req).companyId);
  });

async function dropFile(client: Parameters<typeof insertFileRow>[0], fileId: string | null): Promise<string | null> {
  if (!fileId) return null;
  const f = await one<{ storage_key: string }>(`DELETE FROM files WHERE id = $1 RETURNING storage_key`, [fileId], client);
  return f?.storage_key ?? null;
}
