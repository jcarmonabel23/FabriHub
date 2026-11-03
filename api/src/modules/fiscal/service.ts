/**
 * @project FabriHub - API
 * @file src/modules/fiscal/service.ts
 * @description Venezuela (fase 19): documento fiscal de las ventas del POS según el emisor de la caja
 *
 * @overview
 * Al confirmar una venta (misma transacción) se reserva su documento fiscal si la caja tiene emisor:
 *   · impresora fiscal: queda pendiente en la caja. El navegador pide el documento canónico
 *     (GET /fiscal/documents/:id/payload), se lo entrega al agente local, y reporta lo impreso
 *     (POST …/printed: número de factura, serial de la máquina y contador Z);
 *   · imprenta digital: la API lo envía al proveedor justo después de confirmar (y la cola reintenta
 *     cada minuto con espera creciente); el proveedor asigna el número de control y devuelve el PDF.
 * Contingencia (falla la impresora o el proveedor): el cajero emite el formato físico y registra su
 * número; con imprenta digital, la cola lo transmite después (registro posterior).
 * Anular la venta emite una nota de crédito fiscal que referencia la factura. Si la factura de la
 * impresora aún no se imprimió, se cancela; si se imprime igual (carrera), se genera la nota.
 */

import type pg from "pg";
import { z } from "zod";
import { config } from "../../config.js";
import { currentCompanyId, one, query, runInCompany, withTx, type Db } from "../../db.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { currentCountry } from "../../lib/taxId.js";
import { txCtx } from "../../security/context.js";
import { DigitalPrinterIssuer, FiscalError } from "./digital.js";
import { FISCAL_DOC_NAMES, payloadOf, type FiscalDocType, type FiscalMode, type FiscalResult } from "./protocol.js";

export const DEFAULT_AGENT_URL = "http://127.0.0.1:7788";
const API_KEY = "fiscal_digital_api_key";

// ------------------------------------------------------------------ Configuración

interface Settings {
  digital_enabled: boolean;
  provider_name: string | null;
  environment: "test" | "prod";
  api_url: string | null;
  series: string | null;
  contingency: boolean;
}

async function settingsOf(db?: Db): Promise<Settings | null> {
  return one<Settings>(`SELECT digital_enabled, provider_name, environment, api_url, series, contingency FROM fiscal_settings`, [], db);
}

async function readApiKey(): Promise<string | null> {
  const row = await one<{ ciphertext: string }>(`SELECT ciphertext FROM company_secrets WHERE key = $1`, [API_KEY]);
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext);
  } catch {
    throw new FiscalError("La clave de API guardada no se puede descifrar (cambió la clave del servidor): vuelva a cargarla", false);
  }
}

async function digitalIssuer(s: Settings | null): Promise<DigitalPrinterIssuer> {
  if (!s?.digital_enabled || !s.api_url || !s.provider_name) throw new FiscalError("La imprenta digital no está activa en la configuración", false);
  const apiKey = await readApiKey();
  if (!apiKey) throw new FiscalError("Falta la clave de API de la imprenta digital", false);
  return new DigitalPrinterIssuer({ apiUrl: s.api_url, apiKey, environment: s.environment, series: s.series, providerName: s.provider_name });
}

export async function assertFiscalCountry() {
  const country = await currentCountry();
  if (!country.features.fiscalDoc) throw badRequest("FISCAL_NOT_AVAILABLE", `${country.name} no usa el documento fiscal de Venezuela`);
}

/** Validación del emisor elegido para una caja (al crearla o editarla) */
export async function assertTerminalIssuer(client: pg.PoolClient, mode: FiscalMode) {
  if (mode === "none") return;
  await assertFiscalCountry();
  if (mode === "digital" && !(await settingsOf(client))?.digital_enabled) {
    throw badRequest("FISCAL_NOT_CONFIGURED", "Active primero la imprenta digital en Configuración → Documento fiscal");
  }
}

// ------------------------------------------------------------------ Emisión (dentro de la transacción de la venta)

export interface ReservedFiscal {
  id: string;
  issuer: Exclude<FiscalMode, "none">;
}

/**
 * @function issueFiscalForSale
 * @description Reserva el documento fiscal de una venta recién creada según el emisor de su caja.
 * No hace nada fuera de Venezuela o en cajas sin emisor fiscal.
 */
export async function issueFiscalForSale(client: pg.PoolClient, saleId: string): Promise<ReservedFiscal | null> {
  const v = (await one<{ mode: FiscalMode; on: boolean; terminal_id: string; total: string; igtf: string }>(
    `SELECT t.fiscal_mode AS mode, fn_country_has('fiscalDoc') AS on, v.terminal_id, v.grand_total AS total, v.igtf_amount AS igtf
       FROM pos_sales v JOIN pos_terminals t ON t.id = v.terminal_id WHERE v.id = $1`,
    [saleId],
    client
  ))!;
  if (!v.on || v.mode === "none") return null;
  if (v.mode === "digital" && !(await settingsOf(client))?.digital_enabled) {
    throw badRequest("FISCAL_NOT_CONFIGURED", "La caja emite con imprenta digital, pero la empresa no la tiene activa");
  }
  const row = await one<{ id: string }>(
    `INSERT INTO fiscal_documents (doc_type, issuer, sale_id, terminal_id, total, igtf_amount, created_by)
     VALUES ('FAC', $1, $2, $3, $4, $5, fn_current_app_user()) RETURNING id`,
    [v.mode, saleId, v.terminal_id, v.total, v.igtf],
    client
  );
  return { id: row!.id, issuer: v.mode };
}

async function insertCreditNote(client: pg.PoolClient, fac: { id: string; issuer: string; sale_id: string; terminal_id: string; total: string; igtf_amount: string }, reason: string) {
  const row = await one<{ id: string; issuer: ReservedFiscal["issuer"] }>(
    `INSERT INTO fiscal_documents (doc_type, issuer, sale_id, terminal_id, reference_id, total, igtf_amount, reason, created_by)
     VALUES ('NC', $1, $2, $3, $4, $5, $6, $7, fn_current_app_user())
     ON CONFLICT (company_id, sale_id, doc_type) DO NOTHING RETURNING id, issuer`,
    [fac.issuer, fac.sale_id, fac.terminal_id, fac.id, fac.total, fac.igtf_amount, reason.slice(0, 180)],
    client
  );
  return row ?? null;
}

/**
 * @function fiscalCreditNoteForSale
 * @description Al anular una venta: nota de crédito que anula su factura. La factura de una impresora
 * que aún no se imprimió se cancela (no hay nada que anular); la de la imprenta digital se emite
 * igual (puede estar en camino) y la nota espera por ella.
 */
export async function fiscalCreditNoteForSale(client: pg.PoolClient, saleId: string, reason: string): Promise<ReservedFiscal | null> {
  const fac = await one<{ id: string; issuer: string; status: string; sale_id: string; terminal_id: string; total: string; igtf_amount: string }>(
    `SELECT id, issuer, status, sale_id, terminal_id, total, igtf_amount FROM fiscal_documents WHERE sale_id = $1 AND doc_type = 'FAC' FOR UPDATE`,
    [saleId],
    client
  );
  if (!fac || fac.status === "cancelled") return null;
  if (fac.status === "pending" && fac.issuer === "printer") {
    await client.query(
      `UPDATE fiscal_documents SET status = 'cancelled', last_error = 'Venta anulada antes de imprimir la factura', updated_at = NOW() WHERE id = $1`,
      [fac.id]
    );
    return null;
  }
  return insertCreditNote(client, fac, reason);
}

// ------------------------------------------------------------------ Cola de la imprenta digital

interface DocRow {
  id: string;
  doc_type: FiscalDocType;
  issuer: string;
  sale_id: string;
  terminal_id: string;
  reference_id: string | null;
  reason: string | null;
  status: string;
  attempts: number;
  contingency_form: string | null;
  contingency_at_text: string | null;
}

const DOC_ROW = `SELECT d.id, d.doc_type, d.issuer, d.sale_id, d.terminal_id, d.reference_id, d.reason, d.status, d.attempts, d.contingency_form,
       to_char(d.contingency_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS contingency_at_text
  FROM fiscal_documents d`;

const MAX_BACKOFF_S = 3600;
const backoff = (attempts: number) => Math.min(MAX_BACKOFF_S, 30 * 2 ** Math.min(attempts, 7));

async function postpone(id: string, error: string | null, seconds: number, countAttempt = true) {
  await withTx({ userId: null }, (client) =>
    client.query(
      `UPDATE fiscal_documents SET attempts = attempts + $4, last_error = $2, next_attempt_at = NOW() + make_interval(secs => $3), updated_at = NOW() WHERE id = $1`,
      [id, error?.slice(0, 1000) ?? null, seconds, countAttempt ? 1 : 0]
    )
  );
}

/** Guarda lo que devolvió el emisor; el PDF va aparte de la respuesta */
async function markIssued(db: pg.PoolClient, id: string, r: FiscalResult, registered: boolean) {
  const { pdfBase64, ...rest } = r;
  await db.query(
    `UPDATE fiscal_documents SET status = 'issued', document_number = $2, control_number = $3, machine_serial = $4, z_number = $5,
            issued_at = $6, pdf = $7, pdf_url = $8, provider_response = $9, registered_at = CASE WHEN $10 THEN NOW() END,
            last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [
      id,
      r.documentNumber,
      r.controlNumber,
      r.machineSerial,
      r.zNumber,
      r.issuedAt,
      pdfBase64 ? Buffer.from(pdfBase64, "base64") : null,
      r.pdfUrl ?? null,
      JSON.stringify(rest),
      registered
    ]
  );
}

/** Un paso de la cola para un documento de la imprenta digital. Nunca lanza. */
async function step(doc: DocRow, s: Settings | null): Promise<void> {
  try {
    // En contingencia no se envía: lo pendiente espera su formato físico y lo físico, el registro posterior
    if (s?.contingency) {
      await postpone(doc.id, null, 300, false);
      return;
    }
    if (doc.doc_type === "NC" && doc.reference_id) {
      const ref = await one<{ status: string }>(`SELECT status FROM fiscal_documents WHERE id = $1`, [doc.reference_id]);
      if (ref?.status === "cancelled") {
        await withTx({ userId: null }, (c) =>
          c.query(`UPDATE fiscal_documents SET status = 'cancelled', last_error = 'La factura que anula no se emitió', updated_at = NOW() WHERE id = $1`, [doc.id])
        );
        return;
      }
      if (ref?.status !== "issued") {
        await postpone(doc.id, "Espera a que se emita la factura que anula", 60, false);
        return;
      }
    }
    const issuer = await digitalIssuer(s);
    const result = await issuer.issue(await payloadOf(doc));
    await withTx({ userId: null }, (c) => markIssued(c, doc.id, result, doc.status === "contingency"));
  } catch (err) {
    const known = err instanceof FiscalError;
    if (!known) logger.error({ err, doc: doc.id }, "[fiscal] error inesperado en la cola");
    const retry = known ? err.retry : false;
    await postpone(doc.id, known ? err.message : `Error interno: ${(err as Error).message}`, retry ? backoff(doc.attempts + 1) : 3600).catch(() => undefined);
  }
}

const inflight = new Map<string, Promise<number>>();

/** Procesa lo vencido de la empresa activa (o solo `onlyId`); `wait` = esperar la pasada en curso */
async function processDue(onlyId?: string, limit = 25, wait = false): Promise<number> {
  const companyId = currentCompanyId() ?? "";
  while (inflight.has(companyId)) {
    if (!wait) return 0;
    await inflight.get(companyId)!.catch(() => 0);
  }
  const run = (async () => {
    const s = await settingsOf();
    const docs = await query<DocRow>(
      `${DOC_ROW} WHERE d.issuer = 'digital' AND d.status IN ('pending', 'contingency')
          AND ($1::uuid IS NOT NULL AND d.id = $1 OR $1::uuid IS NULL AND d.next_attempt_at <= NOW())
        ORDER BY d.created_at LIMIT $2`,
      [onlyId ?? null, limit]
    );
    for (const doc of docs) await step(doc, s);
    return docs.length;
  })();
  inflight.set(companyId, run);
  try {
    return await run;
  } finally {
    inflight.delete(companyId);
  }
}

/** En segundo plano, sin esperar (tras anular o salir de contingencia) */
export function kickFiscalQueue(): void {
  const companyId = currentCompanyId();
  if (!companyId) return;
  setImmediate(() => {
    runInCompany(companyId, () => processDue()).catch((err) => logger.error({ err, companyId }, "[fiscal] la cola falló"));
  });
}

const ISSUE_NOW_MS = 8_000;

/**
 * Justo después de confirmar la venta: intenta emitir ya con la imprenta digital para que el ticket
 * salga con su número de control. Si tarda, la venta responde igual y la cola sigue.
 */
export async function issueFiscalNow(reserved: ReservedFiscal | null): Promise<void> {
  if (reserved?.issuer !== "digital") return;
  const work = processDue(reserved.id, 1, true).catch((err) => logger.error({ err }, "[fiscal] emisión inmediata"));
  await Promise.race([work, new Promise((r) => setTimeout(r, ISSUE_NOW_MS).unref())]);
}

const TICK_MS = 60_000;

export function startFiscalQueue(firstDelayMs = 40_000): void {
  const tick = async () => {
    try {
      const companies = await query<{ company_id: string }>(
        `SELECT DISTINCT company_id FROM fiscal_documents WHERE issuer = 'digital' AND status IN ('pending', 'contingency') AND next_attempt_at <= NOW()`
      );
      for (const c of companies) await runInCompany(c.company_id, () => processDue());
    } catch (err) {
      logger.error({ err }, "[fiscal] no se pudo recorrer la cola");
    } finally {
      setTimeout(tick, TICK_MS).unref();
    }
  };
  setTimeout(tick, firstDelayMs).unref();
}

// ------------------------------------------------------------------ Datos para la venta y el ticket

export interface SaleFiscalDoc {
  id: string;
  docType: FiscalDocType;
  docName: string;
  issuer: "printer" | "digital";
  status: string;
  documentNumber: string | null;
  controlNumber: string | null;
  machineSerial: string | null;
  contingencyForm: string | null;
  issuedAt: string | null;
  lastError: string | null;
  hasPdf: boolean;
}

export async function saleFiscalDocs(saleId: string, db?: Db): Promise<SaleFiscalDoc[]> {
  const rows = await query<Omit<SaleFiscalDoc, "docName">>(
    `SELECT id, doc_type AS "docType", issuer, status, document_number AS "documentNumber", control_number AS "controlNumber",
            machine_serial AS "machineSerial", contingency_form AS "contingencyForm", issued_at AS "issuedAt", last_error AS "lastError",
            (pdf IS NOT NULL OR pdf_url IS NOT NULL) AS "hasPdf"
       FROM fiscal_documents WHERE sale_id = $1 ORDER BY created_at`,
    [saleId],
    db
  );
  return rows.map((r) => ({ ...r, docName: FISCAL_DOC_NAMES[r.docType] }));
}

/** Documentos de la impresora fiscal sin imprimir en las ventas de un turno (bloquean su cierre) */
export async function pendingPrinterDocs(sessionId: string, db?: Db): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM fiscal_documents d JOIN pos_sales v ON v.id = d.sale_id
      WHERE v.session_id = $1 AND d.issuer = 'printer' AND d.status = 'pending'`,
    [sessionId],
    db
  );
  return r?.n ?? 0;
}

// ------------------------------------------------------------------ Rutas: configuración

async function settingsView() {
  const [s, key, counts, terminals] = await Promise.all([
    settingsOf(),
    one<{ hint: string | null; updatedAt: string }>(`SELECT hint, updated_at AS "updatedAt" FROM company_secrets WHERE key = $1`, [API_KEY]),
    query<{ issuer: string; status: string; n: number }>(`SELECT issuer, status, COUNT(*)::int AS n FROM fiscal_documents GROUP BY issuer, status`),
    query<{ id: string; code: string; name: string; fiscalMode: FiscalMode; isActive: boolean }>(
      `SELECT id, code, name, fiscal_mode AS "fiscalMode", is_active AS "isActive" FROM pos_terminals ORDER BY code`
    )
  ]);
  return {
    digitalEnabled: s?.digital_enabled ?? false,
    providerName: s?.provider_name ?? null,
    environment: s?.environment ?? "test",
    apiUrl: s?.api_url ?? null,
    series: s?.series ?? null,
    contingency: s?.contingency ?? false,
    apiKey: { configured: Boolean(key), hint: key?.hint ?? null, updatedAt: key?.updatedAt ?? null },
    terminals,
    counts: counts.reduce<Record<string, Record<string, number>>>((acc, c) => {
      (acc[c.issuer] ??= {})[c.status] = c.n;
      return acc;
    }, {})
  };
}

export const getFiscalSettings = handler({}, async () => {
  await assertFiscalCountry();
  return settingsView();
});

const settingsBody = z.object({
  digitalEnabled: z.boolean(),
  providerName: z.string().trim().min(2).max(120).nullish(),
  environment: z.enum(["test", "prod"]).default("test"),
  apiUrl: z.url().max(300).nullish(),
  series: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Serie: letras, números o guion (máx. 10)").nullish(),
  contingency: z.boolean().default(false)
});

export const saveFiscalSettings = handler({ body: settingsBody }, async ({ body: b, req }) => {
  await assertFiscalCountry();
  // En producción la clave de API solo viaja cifrada
  if (b.apiUrl && config.APP_ENVIRONMENT === "prod" && !b.apiUrl.startsWith("https://")) {
    throw badRequest("INSECURE_URL", "La URL de la imprenta digital debe usar https");
  }
  if (b.digitalEnabled) {
    const missing: string[] = [];
    if (!b.providerName) missing.push("nombre del proveedor");
    if (!b.apiUrl) missing.push("URL de la API");
    if (!(await one(`SELECT 1 FROM company_secrets WHERE key = $1`, [API_KEY]))) missing.push("clave de API");
    if (missing.length) throw badRequest("FISCAL_INCOMPLETE", `Para activar la imprenta digital falta: ${missing.join(", ")}`);
  } else {
    const using = await query<{ code: string }>(`SELECT code FROM pos_terminals WHERE fiscal_mode = 'digital' AND is_active ORDER BY code`);
    if (using.length) {
      throw conflict("TERMINALS_USE_DIGITAL", `Las cajas ${using.map((t) => t.code).join(", ")} emiten con la imprenta digital: cámbielas antes de desactivarla`);
    }
  }
  const wasContingency = (await settingsOf())?.contingency ?? false;
  await withTx(txCtx(req), async (client) => {
    await client.query(
      `INSERT INTO fiscal_settings (digital_enabled, provider_name, environment, api_url, series, contingency, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user())
       ON CONFLICT (company_id) DO UPDATE SET digital_enabled = EXCLUDED.digital_enabled, provider_name = EXCLUDED.provider_name,
              environment = EXCLUDED.environment, api_url = EXCLUDED.api_url, series = EXCLUDED.series,
              contingency = EXCLUDED.contingency, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [b.digitalEnabled, b.providerName ?? null, b.environment, b.apiUrl ?? null, b.series ?? null, b.contingency]
    );
    // Al salir de contingencia, lo que esperaba (pendiente o por registrar) se envía ya
    if (wasContingency && !b.contingency) {
      await client.query(`UPDATE fiscal_documents SET next_attempt_at = NOW() WHERE issuer = 'digital' AND status IN ('pending', 'contingency')`);
    }
  });
  if (wasContingency && !b.contingency) kickFiscalQueue();
  return settingsView();
});

export const saveFiscalApiKey = handler({ body: z.object({ apiKey: z.string().trim().min(8).max(500) }) }, async ({ body, req }) => {
  await assertFiscalCountry();
  const hint = `…${body.apiKey.slice(-4)}`;
  await withTx(txCtx(req), (client) =>
    client.query(
      `INSERT INTO company_secrets (key, ciphertext, hint, updated_by) VALUES ($1, $2, $3, fn_current_app_user())
       ON CONFLICT (company_id, key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint,
                                                   updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [API_KEY, encryptSecret(body.apiKey), hint]
    )
  );
  return { configured: true, hint };
});

export const deleteFiscalApiKey = handler({}, async ({ req }) => {
  await assertFiscalCountry();
  const using = await query<{ code: string }>(`SELECT code FROM pos_terminals WHERE fiscal_mode = 'digital' AND is_active ORDER BY code`);
  if (using.length) throw conflict("TERMINALS_USE_DIGITAL", `Las cajas ${using.map((t) => t.code).join(", ")} emiten con la imprenta digital`);
  await withTx(txCtx(req), async (client) => {
    await client.query(`DELETE FROM company_secrets WHERE key = $1`, [API_KEY]);
    await client.query(`UPDATE fiscal_settings SET digital_enabled = FALSE, updated_by = fn_current_app_user(), updated_at = NOW()`);
  });
  return undefined;
});

/** Prueba la conexión con la imprenta digital (URL y clave guardadas) */
export const testFiscalDigital = handler({}, async () => {
  await assertFiscalCountry();
  const s = await settingsOf();
  if (!s?.api_url) throw badRequest("FISCAL_INCOMPLETE", "Guarde primero la URL de la API");
  const apiKey = await readApiKey();
  if (!apiKey) throw badRequest("FISCAL_INCOMPLETE", "Cargue primero la clave de API");
  const issuer = new DigitalPrinterIssuer({ apiUrl: s.api_url, apiKey, environment: s.environment, series: s.series, providerName: s.provider_name ?? "" });
  try {
    return await issuer.status();
  } catch (err) {
    if (err instanceof FiscalError) throw badRequest("FISCAL_UNREACHABLE", err.message);
    throw err;
  }
});

// ------------------------------------------------------------------ Rutas: documentos

const DOC_SELECT = `SELECT d.id, d.doc_type AS "docType", d.issuer, d.status, d.total::float AS total, d.igtf_amount::float AS "igtfAmount",
       d.document_number AS "documentNumber", d.control_number AS "controlNumber", d.machine_serial AS "machineSerial", d.z_number AS "zNumber",
       d.issued_at AS "issuedAt", d.contingency_form AS "contingencyForm", d.contingency_at AS "contingencyAt", d.registered_at AS "registeredAt",
       d.attempts, d.last_error AS "lastError", d.next_attempt_at AS "nextAttemptAt", d.reason, d.created_at AS "createdAt",
       (d.pdf IS NOT NULL OR d.pdf_url IS NOT NULL) AS "hasPdf",
       d.sale_id AS "saleId", v.ticket_number AS "ticketNumber", v.status AS "saleStatus", c.legal_name AS "customerName", c.rif AS "customerTaxId",
       d.terminal_id AS "terminalId", t.code AS "terminalCode",
       r.document_number AS "referenceNumber", COALESCE(r.control_number, r.contingency_form) AS "referenceControl", r.status AS "referenceStatus"
  FROM fiscal_documents d
  JOIN pos_sales v ON v.id = d.sale_id
  JOIN customers c ON c.id = v.customer_id
  JOIN pos_terminals t ON t.id = d.terminal_id
  LEFT JOIN fiscal_documents r ON r.id = d.reference_id`;

const docsQuery = pageQuery.extend({
  status: z.enum(["pending", "issued", "contingency", "cancelled"]).optional(),
  docType: z.enum(["FAC", "NC"]).optional(),
  issuer: z.enum(["printer", "digital"]).optional(),
  terminalId: z.uuid().optional(),
  saleId: z.uuid().optional(),
  search: z.string().trim().max(80).optional()
});

export const listFiscalDocuments = handler({ query: docsQuery }, async ({ query: q }) => {
  const rows = await query<{ total_rows?: number; docType: FiscalDocType }>(
    `SELECT COUNT(*) OVER()::int AS total_rows, x.* FROM (${DOC_SELECT}) x
      WHERE ($1::text IS NULL OR x.status = $1) AND ($2::text IS NULL OR x."docType" = $2) AND ($3::text IS NULL OR x.issuer = $3)
        AND ($4::uuid IS NULL OR x."terminalId" = $4) AND ($5::uuid IS NULL OR x."saleId" = $5)
        AND ($6::text IS NULL OR x."documentNumber" ILIKE '%' || $6 || '%' OR x."controlNumber" ILIKE '%' || $6 || '%'
             OR x."contingencyForm" ILIKE '%' || $6 || '%' OR x."ticketNumber" ILIKE '%' || $6 || '%' OR x."customerName" ILIKE '%' || $6 || '%')
      ORDER BY x."createdAt" DESC LIMIT $7 OFFSET $8`,
    [q.status ?? null, q.docType ?? null, q.issuer ?? null, q.terminalId ?? null, q.saleId ?? null, q.search || null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = rows[0]?.total_rows ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => ({ ...r, docName: FISCAL_DOC_NAMES[r.docType] })), total, page: q.page, pageSize: q.pageSize };
});

async function docDetail(id: string, db?: Db) {
  const doc = await one<{ docType: FiscalDocType }>(`${DOC_SELECT} WHERE d.id = $1`, [id], db);
  if (!doc) throw notFound("Documento fiscal no encontrado");
  return { ...doc, docName: FISCAL_DOC_NAMES[doc.docType] };
}

export const getFiscalDocument = handler({ params: idParams }, async ({ params }) => docDetail(params.id));

/** Impresora fiscal: documentos por imprimir de una caja (facturas y notas de crédito) */
export const terminalPendingDocs = handler({ params: idParams }, async ({ params }) =>
  (
    await query<{ docType: FiscalDocType }>(
      `SELECT x.* FROM (${DOC_SELECT}) x WHERE x."terminalId" = $1 AND x.issuer = 'printer' AND x.status = 'pending' ORDER BY x."createdAt"`,
      [params.id]
    )
  ).map((d) => ({ ...d, docName: FISCAL_DOC_NAMES[d.docType] }))
);

/** Lee un documento bloqueado para cambiarlo (con el serial y el agente de su caja) */
async function lockDoc(client: pg.PoolClient, id: string) {
  const d = await one<DocRow & { machine_serial: string | null; document_number: string | null; expected_serial: string | null; agent_url: string | null }>(
    `SELECT d.id, d.doc_type, d.issuer, d.sale_id, d.terminal_id, d.reference_id, d.reason, d.status, d.attempts, d.contingency_form,
            NULL AS contingency_at_text, d.machine_serial, d.document_number, t.fiscal_serial AS expected_serial, t.fiscal_agent_url AS agent_url
       FROM fiscal_documents d JOIN pos_terminals t ON t.id = d.terminal_id WHERE d.id = $1 FOR UPDATE OF d`,
    [id],
    client
  );
  if (!d) throw notFound("Documento fiscal no encontrado");
  return d;
}

/** La nota de crédito se imprime solo cuando su factura ya existe (impresa o en formato físico) */
async function assertReferenceReady(db: Db | undefined, referenceId: string | null) {
  if (!referenceId) return;
  const ref = await one<{ status: string }>(`SELECT status FROM fiscal_documents WHERE id = $1`, [referenceId], db);
  if (ref?.status !== "issued" && ref?.status !== "contingency") {
    throw conflict("REFERENCE_PENDING", "La factura que anula esta nota de crédito aún no se ha emitido");
  }
}

/** Impresora fiscal: documento canónico para entregarle al agente de la caja */
export const getFiscalPayload = handler({ params: idParams }, async ({ params }) => {
  const doc = await one<DocRow & { agent_url: string | null; expected_serial: string | null }>(
    `SELECT d.id, d.doc_type, d.issuer, d.sale_id, d.terminal_id, d.reference_id, d.reason, d.status, d.attempts, d.contingency_form,
            NULL AS contingency_at_text, t.fiscal_agent_url AS agent_url, t.fiscal_serial AS expected_serial
       FROM fiscal_documents d JOIN pos_terminals t ON t.id = d.terminal_id WHERE d.id = $1`,
    [params.id]
  );
  if (!doc) throw notFound("Documento fiscal no encontrado");
  if (doc.issuer !== "printer") throw conflict("NOT_PRINTER", "Este documento lo emite la imprenta digital");
  if (doc.status !== "pending") throw conflict("FISCAL_FINAL", "El documento ya se emitió o se canceló");
  await assertReferenceReady(undefined, doc.reference_id);
  return { agentUrl: doc.agent_url || DEFAULT_AGENT_URL, expectedSerial: doc.expected_serial, payload: await payloadOf(doc) };
});

const printedBody = z.object({
  documentNumber: z.string().trim().min(1).max(30),
  machineSerial: z.string().trim().min(3).max(30),
  zNumber: z.number().int().min(0).nullish(),
  issuedAt: z.iso.datetime({ offset: true }).nullish()
});

/** Impresora fiscal: el agente imprimió el documento; se guardan sus números */
export const markFiscalPrinted = handler({ params: idParams, body: printedBody }, async ({ params, body: b, req }) => {
  await withTx(txCtx(req), async (client) => {
    const d = await lockDoc(client, params.id);
    if (d.issuer !== "printer") throw conflict("NOT_PRINTER", "Este documento lo emite la imprenta digital");
    if (d.status === "issued") {
      // Reintento del mismo aviso: no cambia nada
      if (d.document_number === b.documentNumber && d.machine_serial === b.machineSerial) return;
      throw conflict("FISCAL_FINAL", `El documento ya se imprimió con el número ${d.document_number}`);
    }
    if (d.status === "contingency") throw conflict("FISCAL_FINAL", "El documento ya se emitió en formato de contingencia");
    if (d.expected_serial && d.expected_serial !== b.machineSerial) {
      throw conflict("SERIAL_MISMATCH", `La impresora reporta el serial ${b.machineSerial}, pero la caja tiene registrada la ${d.expected_serial}`);
    }
    await assertReferenceReady(client, d.reference_id);
    const wasCancelled = d.status === "cancelled";
    await markIssued(client, d.id, { documentNumber: b.documentNumber, controlNumber: null, machineSerial: b.machineSerial, zNumber: b.zNumber ?? null, issuedAt: b.issuedAt ?? new Date().toISOString() }, false);
    // Se imprimió una factura de una venta ya anulada (carrera con la anulación): se anula con su nota
    if (wasCancelled && d.doc_type === "FAC") {
      const fac = (await one<{ id: string; issuer: string; sale_id: string; terminal_id: string; total: string; igtf_amount: string; reason: string | null }>(
        `SELECT d.id, d.issuer, d.sale_id, d.terminal_id, d.total, d.igtf_amount, v.void_reason AS reason
           FROM fiscal_documents d JOIN pos_sales v ON v.id = d.sale_id WHERE d.id = $1`,
        [d.id],
        client
      ))!;
      await insertCreditNote(client, fac, fac.reason ?? "Anulación de la venta");
    }
  });
  return docDetail(params.id);
});

/** Impresora fiscal: el agente no pudo imprimir (se deja constancia para el supervisor) */
export const markFiscalFailed = handler({ params: idParams, body: z.object({ error: z.string().trim().min(1).max(1000) }) }, async ({ params, body, req }) => {
  await withTx(txCtx(req), async (client) => {
    const d = await lockDoc(client, params.id);
    if (d.status !== "pending") throw conflict("FISCAL_FINAL", "El documento ya se emitió o se canceló");
    await client.query(`UPDATE fiscal_documents SET attempts = attempts + 1, last_error = $2, updated_at = NOW() WHERE id = $1`, [d.id, body.error]);
  });
  return docDetail(params.id);
});

/** Contingencia: se emitió el formato físico con este número de control */
export const markFiscalContingency = handler(
  { params: idParams, body: z.object({ formNumber: z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/, "Número del formato: letras, números o guion") }) },
  async ({ params, body, req }) => {
    let digital = false;
    await withTx(txCtx(req), async (client) => {
      const d = await lockDoc(client, params.id);
      if (d.status !== "pending") throw conflict("FISCAL_FINAL", "El documento ya se emitió o se canceló");
      await assertReferenceReady(client, d.reference_id);
      const dup = await one(`SELECT 1 FROM fiscal_documents WHERE contingency_form = $1 AND id <> $2`, [body.formNumber, d.id], client);
      if (dup) throw conflict("FORM_DUPLICATED", `El formato ${body.formNumber} ya se usó en otro documento`);
      await client.query(
        `UPDATE fiscal_documents SET status = 'contingency', contingency_form = $2, contingency_at = NOW(), contingency_by = fn_current_app_user(),
                next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [d.id, body.formNumber]
      );
      digital = d.issuer === "digital";
    });
    if (digital) kickFiscalQueue();
    return docDetail(params.id);
  }
);

/** Imprenta digital: reintentar ya (envío o registro posterior) */
export const retryFiscalDocument = handler({ params: idParams }, async ({ params, req }) => {
  const doc = await one<{ status: string; issuer: string }>(`SELECT status, issuer FROM fiscal_documents WHERE id = $1`, [params.id]);
  if (!doc) throw notFound("Documento fiscal no encontrado");
  if (doc.issuer !== "digital") throw conflict("NOT_DIGITAL", "Los documentos de la impresora fiscal se imprimen desde la caja");
  if (doc.status !== "pending" && doc.status !== "contingency") throw conflict("FISCAL_FINAL", "El documento ya se emitió o se canceló");
  await withTx(txCtx(req), (client) => client.query(`UPDATE fiscal_documents SET next_attempt_at = NOW() WHERE id = $1`, [params.id]));
  await processDue(params.id, 1, true);
  return docDetail(params.id);
});

/** Procesa ya lo vencido de la imprenta digital */
export const processFiscalQueue = handler({}, async () => {
  await assertFiscalCountry();
  const processed = await processDue(undefined, 50, true);
  return { processed };
});

/** PDF de la imprenta digital (guardado, o el enlace del proveedor) */
export const getFiscalPdf = handler({ params: idParams }, async ({ params, res }) => {
  const row = await one<{ pdf: Buffer | null; pdf_url: string | null; doc_type: FiscalDocType; control_number: string | null }>(
    `SELECT pdf, pdf_url, doc_type, control_number FROM fiscal_documents WHERE id = $1`,
    [params.id]
  );
  if (!row) throw notFound("Documento fiscal no encontrado");
  if (!row.pdf && row.pdf_url) return { url: row.pdf_url };
  if (!row.pdf) throw conflict("PDF_NOT_READY", "La imprenta digital aún no ha devuelto el PDF");
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `inline; filename="${row.doc_type}-${(row.control_number ?? params.id).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`);
  res.send(row.pdf);
  return undefined;
});

// ------------------------------------------------------------------ Rutas: reportes Z

const zBody = z.object({
  terminalId: z.uuid(),
  machineSerial: z.string().trim().min(3).max(30),
  zNumber: z.number().int().min(1),
  reportDate: z.iso.date(),
  firstInvoice: z.string().trim().max(30).nullish(),
  lastInvoice: z.string().trim().max(30).nullish(),
  lastCreditNote: z.string().trim().max(30).nullish(),
  invoicesCount: z.number().int().min(0).default(0),
  creditNotesCount: z.number().int().min(0).default(0),
  totals: z.record(z.string(), z.unknown()).default({})
});

/** Registra el reporte Z que devolvió la impresora fiscal de la caja */
export const saveZReport = handler({ body: zBody }, async ({ body: b, req, res }) => {
  await assertFiscalCountry();
  const id = await withTx(txCtx(req), async (client) => {
    const t = await one<{ mode: FiscalMode; serial: string | null; session_id: string | null }>(
      `SELECT t.fiscal_mode AS mode, t.fiscal_serial AS serial, s.id AS session_id
         FROM pos_terminals t LEFT JOIN pos_sessions s ON s.terminal_id = t.id AND s.status = 'open' WHERE t.id = $1`,
      [b.terminalId],
      client
    );
    if (!t) throw notFound("Caja no encontrada");
    if (t.mode !== "printer") throw conflict("NOT_PRINTER", "La caja no tiene impresora fiscal");
    if (t.serial && t.serial !== b.machineSerial) {
      throw conflict("SERIAL_MISMATCH", `La impresora reporta el serial ${b.machineSerial}, pero la caja tiene registrada la ${t.serial}`);
    }
    try {
      const row = await one<{ id: string }>(
        `INSERT INTO fiscal_z_reports (terminal_id, session_id, machine_serial, z_number, report_date, first_invoice, last_invoice, last_credit_note,
                                       invoices_count, credit_notes_count, totals, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, fn_current_app_user()) RETURNING id`,
        [b.terminalId, t.session_id, b.machineSerial, b.zNumber, b.reportDate, b.firstInvoice ?? null, b.lastInvoice ?? null, b.lastCreditNote ?? null,
         b.invoicesCount, b.creditNotesCount, JSON.stringify(b.totals)],
        client
      );
      return row!.id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict("Z_DUPLICATED", `El reporte Z ${b.zNumber} de la máquina ${b.machineSerial} ya está registrado`);
      throw err;
    }
  });
  res.status(201);
  return one(`${Z_SELECT} WHERE z.id = $1`, [id]);
});

const Z_SELECT = `SELECT z.id, z.terminal_id AS "terminalId", t.code AS "terminalCode", z.session_id AS "sessionId", s.number AS "sessionNumber",
       z.machine_serial AS "machineSerial", z.z_number AS "zNumber", to_char(z.report_date, 'YYYY-MM-DD') AS "reportDate",
       z.first_invoice AS "firstInvoice", z.last_invoice AS "lastInvoice", z.last_credit_note AS "lastCreditNote",
       z.invoices_count AS "invoicesCount", z.credit_notes_count AS "creditNotesCount", z.totals, u.names AS "createdByName", z.created_at AS "createdAt"
  FROM fiscal_z_reports z
  JOIN pos_terminals t ON t.id = z.terminal_id
  LEFT JOIN pos_sessions s ON s.id = z.session_id
  LEFT JOIN users u ON u.id = z.created_by`;

export const listZReports = handler({ query: pageQuery.extend({ terminalId: z.uuid().optional() }) }, async ({ query: q }) => {
  const rows = await query<{ total_rows?: number }>(
    `SELECT COUNT(*) OVER()::int AS total_rows, x.* FROM (${Z_SELECT}) x
      WHERE ($1::uuid IS NULL OR x."terminalId" = $1) ORDER BY x."createdAt" DESC LIMIT $2 OFFSET $3`,
    [q.terminalId ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { items: rows.map(({ total_rows: _t, ...r }) => r), total: rows[0]?.total_rows ?? 0, page: q.page, pageSize: q.pageSize };
});
