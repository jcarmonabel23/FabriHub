/**
 * @project FabriHub - API
 * @file src/modules/einvoice/service.ts
 * @description Comprobantes electrónicos de Costa Rica (fase 18): emisión desde el POS, nota de
 * crédito al anular, cola de envío a Hacienda y configuración de la empresa
 *
 * @overview
 * Al confirmar una venta (en su misma transacción) se reserva el comprobante: tipo (tiquete para el
 * consumidor final, factura si el cliente está identificado), consecutivo de la caja y clave de 50
 * dígitos. Anular la venta reserva una nota de crédito que lo referencia (código 01, anula).
 * La firma y el envío ocurren después, en la cola: el XML 4.4 se arma desde la venta, se firma con
 * la llave .p12 de la empresa (XAdES-EPES), se envía a la API de recepción y se consulta su estado
 * hasta aceptado o rechazado. Los errores de red se reintentan con espera creciente.
 * En modo contingencia los comprobantes nacen con situación 3 (sin internet) y esperan en la cola.
 */

import { randomInt } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { currentCompanyId, one, query, runInCompany, withTx, type Db } from "../../db.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { badRequest, conflict, handler, idParams, notFound, pageQuery } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { currentCountry } from "../../lib/taxId.js";
import { txCtx } from "../../security/context.js";
import { ENDPOINTS, HaciendaError, accessToken, forgetTokens, status as haciendaStatus, submit, type Environment, type Target } from "./hacienda.js";
import { SignerError, loadP12, signXml } from "./signer.js";
import { DOC_CODE, buildXml, parseMensajeHacienda, type Comprobante, type DocType, type Line } from "./xml.js";

// ------------------------------------------------------------------ Catálogos de Hacienda

/** Tipo de identificación del país → código de Hacienda */
const ID_TYPE: Record<string, string> = { FISICA: "01", JURIDICA: "02", DIMEX: "03", NITE: "04", EXTRANJERO: "05" };

/** Tratamiento fiscal de Costa Rica → código de tarifa del IVA (CodigoTarifaIVA) */
const RATE_CODE: Record<string, string> = { G13: "08", R4: "04", R2: "03", R1: "02", T0: "01", EXENTO: "10" };

/** Por si el tratamiento no es uno de los sembrados: por la alícuota */
function rateCodeOf(treatment: string | null, rate: number): string {
  if (treatment && RATE_CODE[treatment]) return RATE_CODE[treatment];
  const byRate: Record<string, string> = { "13": "08", "8": "07", "4": "04", "2": "03", "1": "02", "0.5": "09" };
  return byRate[String(rate)] ?? "10";
}

/** Medio de pago del POS → TipoMedioPago (SINPE Móvil para el pago móvil) */
const PAYMENT_CODE: Record<string, string> = { cash: "01", card: "02", transfer: "04", mobile: "06" };

export const DOC_NAMES: Record<DocType, string> = { FE: "Factura electrónica", TE: "Tiquete electrónico", NC: "Nota de crédito electrónica" };

// ------------------------------------------------------------------ Configuración y secretos

const SECRET = { user: "atv_user", password: "atv_password", p12: "atv_p12", pin: "atv_p12_pin" } as const;

interface Settings {
  is_enabled: boolean;
  environment: Environment;
  activity_code: string | null;
  provider_id: string | null;
  province: number | null;
  canton: string | null;
  district: string | null;
  neighborhood: string | null;
  other_signs: string | null;
  service_unit: string;
  contingency: boolean;
  idp_url: string | null;
  api_url: string | null;
}

async function settingsOf(db?: Db): Promise<Settings | null> {
  return one<Settings>(`SELECT * FROM einvoice_settings`, [], db);
}

async function readSecret(key: string): Promise<string | null> {
  const row = await one<{ ciphertext: string }>(`SELECT ciphertext FROM company_secrets WHERE key = $1`, [key]);
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext);
  } catch {
    throw new HaciendaError("Las credenciales guardadas no se pueden descifrar (cambió la clave del servidor): vuelva a cargarlas", false);
  }
}

async function writeSecret(client: pg.PoolClient, key: string, value: string, hint: string | null) {
  await client.query(
    `INSERT INTO company_secrets (key, ciphertext, hint, updated_by) VALUES ($1, $2, $3, fn_current_app_user())
     ON CONFLICT (company_id, key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint,
                                                 updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, encryptSecret(value), hint]
  );
}

function targetOf(s: Settings): Target {
  const e = ENDPOINTS[s.environment];
  // Las URL simuladas solo valen en el ambiente de pruebas (sandbox); en «prod» siempre las oficiales
  const mock = s.environment === "sandbox";
  return {
    environment: s.environment,
    idpUrl: (mock && s.idp_url) || e.idp,
    apiUrl: ((mock && s.api_url) || e.api).replace(/\/+$/, ""),
    clientId: e.clientId
  };
}

// ------------------------------------------------------------------ Emisión (dentro de la transacción de la venta)

interface Reserved {
  id: string;
  docType: DocType;
  clave: string;
  consecutive: string;
}

/** Siguiente número del consecutivo de la caja para ese tipo de comprobante */
async function nextNumber(client: pg.PoolClient, branch: number, terminal: number, docType: DocType): Promise<number> {
  const row = await one<{ n: string }>(
    `INSERT INTO einvoice_sequences (branch, terminal, doc_type, next_number) VALUES ($1, $2, $3, 2)
     ON CONFLICT (company_id, branch, terminal, doc_type) DO UPDATE SET next_number = einvoice_sequences.next_number + 1
     RETURNING next_number - 1 AS n`,
    [branch, terminal, docType],
    client
  );
  return Number(row!.n);
}

/** Reserva clave y consecutivo e inserta el comprobante en la cola */
async function reserve(
  client: pg.PoolClient,
  s: Settings,
  saleId: string,
  docType: DocType,
  extra: { total: number; referenceId?: string; reason?: string }
): Promise<Reserved> {
  const t = (await one<{ branch: number; terminal: number; tax_id: string; ddmmyy: string }>(
    `SELECT t.einv_branch AS branch, t.einv_terminal AS terminal, co.rif AS tax_id, to_char(NOW(), 'DDMMYY') AS ddmmyy
       FROM pos_sales v JOIN pos_terminals t ON t.id = v.terminal_id CROSS JOIN companies co
      WHERE v.id = $1 AND co.id = fn_current_company()`,
    [saleId],
    client
  ))!;
  const number = await nextNumber(client, t.branch, t.terminal, docType);
  const consecutive = `${String(t.branch).padStart(3, "0")}${String(t.terminal).padStart(5, "0")}${DOC_CODE[docType]}${String(number).padStart(10, "0")}`;
  const situation = s.contingency ? "3" : "1";
  const security = String(randomInt(0, 100_000_000)).padStart(8, "0");
  const taxId = t.tax_id.replace(/\D/g, "").padStart(12, "0");
  const clave = `506${t.ddmmyy}${taxId}${consecutive}${situation}${security}`;
  const row = await one<{ id: string }>(
    `INSERT INTO einvoice_documents (doc_type, sale_id, reference_id, clave, consecutive, situation, environment, total, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, fn_current_app_user()) RETURNING id`,
    [docType, saleId, extra.referenceId ?? null, clave, consecutive, situation, s.environment, extra.total, extra.reason ?? null],
    client
  );
  return { id: row!.id, docType, clave, consecutive };
}

/**
 * @function issueForSale
 * @description Reserva el comprobante de una venta recién creada (misma transacción).
 * No hace nada fuera de Costa Rica o si la empresa no activó los comprobantes electrónicos.
 */
export async function issueForSale(client: pg.PoolClient, saleId: string): Promise<Reserved | null> {
  const s = await settingsOf(client);
  if (!s?.is_enabled) return null;
  const sale = (await one<{ final_consumer: boolean; id_type: string; total: string; missing: string | null }>(
    `SELECT c.code = 'CONSUMIDOR_FINAL' AS final_consumer, c.id_type, v.grand_total AS total,
            (SELECT string_agg(p.code, ', ' ORDER BY d.line_no) FROM pos_sales_details d JOIN products p ON p.id = d.product_id
              WHERE d.sale_id = v.id AND p.cabys_code IS NULL) AS missing
       FROM pos_sales v JOIN customers c ON c.id = v.customer_id WHERE v.id = $1`,
    [saleId],
    client
  ))!;
  if (sale.missing) throw badRequest("CABYS_MISSING", `Sin código CABYS (obligatorio para el comprobante electrónico): ${sale.missing}`);
  if (!sale.final_consumer && !ID_TYPE[sale.id_type]) {
    throw badRequest("INVALID_RECEIVER", "El tipo de identificación del cliente no es válido para una factura electrónica");
  }
  return reserve(client, s, saleId, sale.final_consumer ? "TE" : "FE", { total: Number(sale.total) });
}

/**
 * @function creditNoteForSale
 * @description Al anular una venta con comprobante, reserva la nota de crédito que lo anula.
 * Si el comprobante aún no llegó a Hacienda se envía primero y luego la nota; uno rechazado no
 * tiene validez y no se anula.
 */
export async function creditNoteForSale(client: pg.PoolClient, saleId: string, reason: string): Promise<Reserved | null> {
  const doc = await one<{ id: string; total: string }>(
    `SELECT id, total FROM einvoice_documents WHERE sale_id = $1 AND doc_type IN ('FE', 'TE') AND status NOT IN ('cancelled', 'rejected')`,
    [saleId],
    client
  );
  if (!doc) return null;
  const s = await settingsOf(client);
  if (!s) return null;
  return reserve(client, s, saleId, "NC", { total: Number(doc.total), referenceId: doc.id, reason: reason.slice(0, 180) });
}

// ------------------------------------------------------------------ Armado del XML desde la venta

interface DocRow {
  id: string;
  doc_type: DocType;
  sale_id: string;
  reference_id: string | null;
  clave: string;
  consecutive: string;
  issued_at_text: string;
  status: string;
  attempts: number;
  signed_xml: string | null;
  reason: string | null;
}

const DOC_ROW = `SELECT d.id, d.doc_type, d.sale_id, d.reference_id, d.clave, d.consecutive,
       to_char(d.issued_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS issued_at_text, d.status, d.attempts, d.signed_xml, d.reason
  FROM einvoice_documents d`;

async function comprobanteOf(doc: DocRow, s: Settings): Promise<Comprobante> {
  const co = (await one<{ legal_name: string; trade_name: string | null; rif: string; id_type: string; email: string | null }>(
    `SELECT legal_name, trade_name, rif, id_type, email FROM companies WHERE id = fn_current_company()`
  ))!;
  if (!co.email) throw new HaciendaError("La empresa no tiene correo electrónico (obligatorio en el comprobante)", false);
  if (!s.activity_code || !s.province || !s.canton || !s.district || !s.other_signs) {
    throw new HaciendaError("Falta la actividad económica o la ubicación del emisor en la configuración", false);
  }
  const sale = (await one<{ legal_name: string; trade_name: string | null; rif: string; id_type: string; email: string | null; currency: string }>(
    `SELECT c.legal_name, c.trade_name, c.rif, c.id_type, c.email, cur.code AS currency
       FROM pos_sales v JOIN customers c ON c.id = v.customer_id JOIN catalogs_currencies cur ON cur.id = v.currency_id
      WHERE v.id = $1`,
    [doc.sale_id]
  ))!;
  const lines = await query<{ cabys: string; code: string; name: string; is_stockable: boolean; unit: string | null; quantity: string; unit_price: string; net: string; tax: string; rate: string; treatment: string | null }>(
    `SELECT p.cabys_code AS cabys, p.code, p.name, p.is_stockable, u.hacienda_code AS unit, d.quantity, d.unit_price,
            d.net_amount AS net, d.tax_amount AS tax, d.tax_rate AS rate, ft.code AS treatment
       FROM pos_sales_details d
       JOIN products p ON p.id = d.product_id
       JOIN catalogs_units u ON u.id = d.unit_id
       LEFT JOIN fiscal_treatments ft ON ft.id = d.treatment_id
      WHERE d.sale_id = $1 ORDER BY d.line_no`,
    [doc.sale_id]
  );
  const missing = lines.filter((l) => !l.cabys).map((l) => l.code);
  if (missing.length) throw new HaciendaError(`Sin código CABYS: ${missing.join(", ")}`, false);
  const r5 = (n: number) => Math.round(n * 100000) / 100000;
  const xmlLines: Line[] = lines.map((l) => {
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unit_price);
    const amount = r5(quantity * unitPrice);
    const net = Number(l.net);
    return {
      cabys: l.cabys,
      code: l.code,
      quantity,
      unit: l.is_stockable ? (l.unit ?? "Unid") : s.service_unit,
      detail: l.name,
      unitPrice,
      amount,
      discount: Math.max(0, r5(amount - net)),
      rateCode: rateCodeOf(l.treatment, Number(l.rate)),
      rate: Number(l.rate),
      tax: Number(l.tax),
      isService: !l.is_stockable
    };
  });

  // Medios de pago por su monto en la venta: el vuelto se descuenta del efectivo
  let payments: Comprobante["payments"] = [];
  if (doc.doc_type !== "NC") {
    const paid = await query<{ method: string; amount: string }>(
      `SELECT method, SUM(amount_base) AS amount FROM pos_sales_payments WHERE sale_id = $1 GROUP BY method
        ORDER BY CASE method WHEN 'cash' THEN 0 ELSE 1 END, method`,
      [doc.sale_id]
    );
    const total = xmlLines.reduce((a, l) => a + l.amount - l.discount + l.tax, 0);
    let excess = r5(paid.reduce((a, p) => a + Number(p.amount), 0) - total);
    payments = paid.map((p) => {
      const cut = Math.min(Number(p.amount), Math.max(0, excess));
      excess = r5(excess - cut);
      return { code: PAYMENT_CODE[p.method] ?? "99", amount: r5(Number(p.amount) - cut) };
    }).filter((p) => p.amount > 0);
  }

  let rate = 1;
  if (sale.currency !== "CRC") {
    // Moneda base distinta del colón: TipoCambio = colones por unidad de la moneda del comprobante
    const crc = await one<{ rate: string | null }>(
      `SELECT (SELECT r.rate FROM currencies_rates r WHERE r.currency_id = c.id AND r.rate_date <= CURRENT_DATE ORDER BY r.rate_date DESC LIMIT 1) AS rate
         FROM catalogs_currencies c WHERE c.code = 'CRC'`
    );
    if (!crc?.rate) throw new HaciendaError("No hay tasa del colón registrada para el tipo de cambio del comprobante", false);
    rate = r5(1 / Number(crc.rate));
  }

  let reference: Comprobante["reference"] = null;
  if (doc.doc_type === "NC" && doc.reference_id) {
    const ref = (await one<{ doc_type: DocType; clave: string; issued: string }>(
      `SELECT doc_type, clave, to_char(issued_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS issued FROM einvoice_documents WHERE id = $1`,
      [doc.reference_id]
    ))!;
    reference = { docType: ref.doc_type, clave: ref.clave, issuedAt: ref.issued, code: "01", reason: doc.reason || "Anulación de la venta" };
  }

  const receiver =
    doc.doc_type === "TE" || !ID_TYPE[sale.id_type] || sale.rif === "CONSUMIDORFINAL"
      ? null
      : { name: sale.legal_name, idType: ID_TYPE[sale.id_type], id: sale.rif, tradeName: sale.trade_name, email: sale.email };
  return {
    type: doc.doc_type,
    clave: doc.clave,
    consecutive: doc.consecutive,
    providerId: s.provider_id || co.rif,
    activityCode: s.activity_code,
    issuedAt: doc.issued_at_text,
    issuer: {
      name: co.legal_name,
      idType: ID_TYPE[co.id_type] ?? "02",
      id: co.rif,
      tradeName: co.trade_name,
      email: co.email,
      location: { province: s.province, canton: s.canton, district: s.district, neighborhood: s.neighborhood, otherSigns: s.other_signs }
    },
    receiver,
    saleCondition: "01",
    lines: xmlLines,
    currency: { code: sale.currency, rate },
    payments,
    reference
  };
}

// ------------------------------------------------------------------ Cola

const MAX_BACKOFF_S = 3600;
const backoff = (attempts: number) => Math.min(MAX_BACKOFF_S, 30 * 2 ** Math.min(attempts, 7));

async function update(id: string, set: Record<string, unknown>) {
  const keys = Object.keys(set);
  await withTx({ userId: null }, (client) =>
    client.query(`UPDATE einvoice_documents SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1`, [
      id,
      ...keys.map((k) => set[k])
    ])
  );
}

/** Reintento: suma el intento y fija la próxima vez */
async function postpone(doc: DocRow, error: string | null, seconds = backoff(doc.attempts + 1)) {
  await withTx({ userId: null }, (client) =>
    client.query(
      `UPDATE einvoice_documents SET attempts = attempts + 1, last_error = $2, next_attempt_at = NOW() + make_interval(secs => $3), updated_at = NOW() WHERE id = $1`,
      [doc.id, error?.slice(0, 1000) ?? null, seconds]
    )
  );
}

/** Firma el comprobante (una sola vez: los reintentos reenvían el mismo XML) */
async function signedXmlOf(doc: DocRow, s: Settings): Promise<string> {
  if (doc.signed_xml) return doc.signed_xml;
  const [p12, pin] = await Promise.all([readSecret(SECRET.p12), readSecret(SECRET.pin)]);
  if (!p12 || pin === null) throw new HaciendaError("Falta la llave criptográfica (.p12) o su PIN", false);
  const key = loadP12(Buffer.from(p12, "base64"), pin);
  const { xml } = buildXml(await comprobanteOf(doc, s));
  const signed = signXml(xml, key, doc.issued_at_text);
  await update(doc.id, { signed_xml: signed });
  return signed;
}

async function tokenFor(s: Settings): Promise<{ target: Target; token: string }> {
  const [user, password] = await Promise.all([readSecret(SECRET.user), readSecret(SECRET.password)]);
  if (!user || !password) throw new HaciendaError("Faltan el usuario y la clave del ATV", false);
  const target = targetOf(s);
  return { target, token: await accessToken(currentCompanyId() ?? "", target, user, password) };
}

/**
 * Un paso de la cola para un comprobante: enviar (pendiente) o consultar el estado (enviado).
 * Nunca lanza: los errores quedan en last_error y el comprobante se reprograma.
 */
async function step(doc: DocRow, s: Settings): Promise<void> {
  try {
    if (doc.status === "pending") {
      if (s.contingency) return; // en contingencia esperan a que vuelva la conexión
      if (doc.doc_type === "NC" && doc.reference_id) {
        const ref = await one<{ status: string }>(`SELECT status FROM einvoice_documents WHERE id = $1`, [doc.reference_id]);
        if (ref?.status === "rejected" || ref?.status === "cancelled") {
          await update(doc.id, { status: "cancelled", last_error: "El comprobante que anula fue rechazado por Hacienda: la nota no se envía" });
          return;
        }
        if (ref?.status !== "accepted") {
          await postpone({ ...doc, attempts: 0 }, "Espera a que Hacienda acepte el comprobante que anula", 60);
          return;
        }
      }
      const xml = await signedXmlOf(doc, s);
      const { target, token } = await tokenFor(s);
      const co = (await one<{ rif: string; id_type: string }>(`SELECT rif, id_type FROM companies WHERE id = fn_current_company()`))!;
      const receiver = /<Receptor><Nombre>[^<]*<\/Nombre><Identificacion><Tipo>(\d{2})<\/Tipo><Numero>([^<]+)<\/Numero>/.exec(xml);
      await submit(target, token, {
        clave: doc.clave,
        fecha: doc.issued_at_text,
        emisor: { tipoIdentificacion: ID_TYPE[co.id_type] ?? "02", numeroIdentificacion: co.rif },
        receptor: receiver ? { tipoIdentificacion: receiver[1], numeroIdentificacion: receiver[2] } : undefined,
        comprobanteXml: Buffer.from(xml, "utf8").toString("base64")
      });
      await withTx({ userId: null }, (client) =>
        client.query(
          `UPDATE einvoice_documents SET status = 'sent', sent_at = NOW(), attempts = 0, last_error = NULL,
                  next_attempt_at = NOW() + INTERVAL '5 seconds', updated_at = NOW() WHERE id = $1`,
          [doc.id]
        )
      );
      return;
    }
    if (doc.status === "sent") {
      const { target, token } = await tokenFor(s);
      const st = await haciendaStatus(target, token, doc.clave);
      if (st.state === "accepted" || st.state === "rejected" || st.state === "error") {
        const msg = st.responseXml ? parseMensajeHacienda(st.responseXml) : { status: null, detail: null };
        await update(doc.id, {
          status: st.state === "accepted" ? "accepted" : "rejected",
          response_xml: st.responseXml,
          response_message: msg.detail?.slice(0, 4000) ?? null,
          decided_at: new Date(),
          last_error: null
        });
        return;
      }
      if (st.state === "unknown" && doc.attempts >= 5) {
        // Hacienda no lo encuentra: se vuelve a enviar
        await update(doc.id, { status: "pending", attempts: 0, next_attempt_at: new Date(), last_error: "Hacienda no registra el comprobante: se reenvía" });
        return;
      }
      await postpone(doc, null, Math.min(600, 10 * 2 ** Math.min(doc.attempts, 6)));
    }
  } catch (err) {
    const known = err instanceof HaciendaError || err instanceof SignerError;
    if (!known) logger.error({ err, doc: doc.id }, "[einvoice] error inesperado en la cola");
    // Lo que no se arregla reintentando (credenciales, configuración) espera una hora
    const retry = err instanceof HaciendaError ? err.retry : false;
    await postpone(doc, known ? err.message : `Error interno: ${(err as Error).message}`, retry ? undefined : 3600).catch(() => undefined);
  }
}

/** Pasada en curso por empresa: nunca dos a la vez sobre la misma cola */
const inflight = new Map<string, Promise<number>>();

/**
 * Procesa los comprobantes vencidos de la empresa activa (o solo `onlyId`).
 * Si ya hay una pasada en curso: `wait` = esperarla y luego correr; si no, no hace nada.
 */
async function processDue(onlyId?: string, limit = 25, wait = false): Promise<number> {
  const companyId = currentCompanyId() ?? "";
  while (inflight.has(companyId)) {
    if (!wait) return 0;
    await inflight.get(companyId)!.catch(() => 0);
  }
  const run = (async () => {
    const s = await settingsOf();
    if (!s) return 0;
    const docs = await query<DocRow>(
      `${DOC_ROW} WHERE d.status IN ('pending', 'sent') AND ($1::uuid IS NOT NULL AND d.id = $1 OR $1::uuid IS NULL AND d.next_attempt_at <= NOW())
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

/** Tras confirmar una venta o anulación: intenta enviar en segundo plano, sin esperar */
export function kickQueue(): void {
  const companyId = currentCompanyId();
  if (!companyId) return;
  setImmediate(() => {
    runInCompany(companyId, () => processDue()).catch((err) => logger.error({ err, companyId }, "[einvoice] la cola falló"));
  });
}

const TICK_MS = 60_000;

/** Revisa la cola de todas las empresas cada minuto */
export function startEinvoiceQueue(firstDelayMs = 30_000): void {
  const tick = async () => {
    try {
      const companies = await query<{ company_id: string }>(
        `SELECT DISTINCT company_id FROM einvoice_documents WHERE status IN ('pending', 'sent') AND next_attempt_at <= NOW()`
      );
      for (const c of companies) await runInCompany(c.company_id, () => processDue());
    } catch (err) {
      logger.error({ err }, "[einvoice] no se pudo recorrer la cola");
    } finally {
      setTimeout(tick, TICK_MS).unref();
    }
  };
  setTimeout(tick, firstDelayMs).unref();
}

// ------------------------------------------------------------------ Datos para el ticket y la venta

export interface SaleEinvoice {
  id: string;
  docType: DocType;
  docName: string;
  clave: string;
  consecutive: string;
  situation: string;
  status: string;
  issuedAt: string;
}

export async function saleEinvoices(saleId: string, db?: Db): Promise<SaleEinvoice[]> {
  const rows = await query<Omit<SaleEinvoice, "docName">>(
    `SELECT id, doc_type AS "docType", clave, consecutive, situation, status, issued_at AS "issuedAt"
       FROM einvoice_documents WHERE sale_id = $1 ORDER BY created_at`,
    [saleId],
    db
  );
  return rows.map((r) => ({ ...r, docName: DOC_NAMES[r.docType] }));
}

// ------------------------------------------------------------------ Rutas: configuración

async function assertCostaRica() {
  const country = await currentCountry();
  if (!country.features.eInvoice) throw badRequest("EINVOICE_NOT_AVAILABLE", `${country.name} no usa comprobantes electrónicos de Hacienda`);
}

async function configuredSecrets() {
  const rows = await query<{ key: string; hint: string | null; updatedAt: string }>(
    `SELECT key, hint, updated_at AS "updatedAt" FROM company_secrets WHERE key = ANY($1)`,
    [Object.values(SECRET)]
  );
  return new Map(rows.map((r) => [r.key, r]));
}

async function settingsView() {
  const [s, secrets, counts, company, cert] = await Promise.all([
    settingsOf(),
    configuredSecrets(),
    query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM einvoice_documents GROUP BY status`),
    one<{ email: string | null; rif: string; idType: string }>(`SELECT email, rif, id_type AS "idType" FROM companies WHERE id = fn_current_company()`),
    one<{ subject: string | null; expiresAt: string | null }>(`SELECT cert_subject AS subject, cert_expires_at AS "expiresAt" FROM einvoice_settings`)
  ]);
  return {
    isEnabled: s?.is_enabled ?? false,
    environment: s?.environment ?? "sandbox",
    activityCode: s?.activity_code ?? null,
    providerId: s?.provider_id ?? null,
    province: s?.province ?? null,
    canton: s?.canton ?? null,
    district: s?.district ?? null,
    neighborhood: s?.neighborhood ?? null,
    otherSigns: s?.other_signs ?? null,
    serviceUnit: s?.service_unit ?? "Sp",
    contingency: s?.contingency ?? false,
    mockUrls: { idpUrl: s?.idp_url ?? null, apiUrl: s?.api_url ?? null },
    company: { email: company?.email ?? null, taxId: company?.rif ?? null, idType: company?.idType ?? null },
    credentials: {
      configured: secrets.has(SECRET.user) && secrets.has(SECRET.password),
      userHint: secrets.get(SECRET.user)?.hint ?? null,
      updatedAt: secrets.get(SECRET.password)?.updatedAt ?? null
    },
    certificate: {
      configured: secrets.has(SECRET.p12) && secrets.has(SECRET.pin),
      subject: cert?.subject ?? null,
      expiresAt: cert?.expiresAt ?? null
    },
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n]))
  };
}

export const getEinvoiceSettings = handler({}, async () => {
  await assertCostaRica();
  return settingsView();
});

const settingsBody = z.object({
  isEnabled: z.boolean(),
  environment: z.enum(["sandbox", "prod"]),
  activityCode: z.string().trim().regex(/^\d{6}$/, "Actividad económica: 6 dígitos").nullish(),
  providerId: z.string().trim().regex(/^\d{9,12}$/, "Cédula del proveedor: solo dígitos (9 a 12)").nullish(),
  province: z.number().int().min(1).max(7).nullish(),
  canton: z.string().trim().regex(/^\d{2}$/, "Cantón: 2 dígitos").nullish(),
  district: z.string().trim().regex(/^\d{2}$/, "Distrito: 2 dígitos").nullish(),
  neighborhood: z.string().trim().max(50).nullish(),
  otherSigns: z.string().trim().min(5, "Otras señas: al menos 5 caracteres").max(250).nullish(),
  serviceUnit: z.enum(["Sp", "Spe", "Os", "St", "h"]).default("Sp"),
  contingency: z.boolean().default(false),
  /** Solo en el ambiente de pruebas (sandbox): Hacienda simulado (scripts/fiscal-sim) */
  idpUrl: z.url().nullish(),
  apiUrl: z.url().nullish()
});

export const saveEinvoiceSettings = handler({ body: settingsBody }, async ({ body: b, req }) => {
  await assertCostaRica();
  if ((b.idpUrl || b.apiUrl) && b.environment === "prod") throw badRequest("SOURCE_URL_FORBIDDEN", "Las URL simuladas solo valen en el ambiente de pruebas de Hacienda");
  if (b.isEnabled) {
    const missing: string[] = [];
    if (!b.activityCode) missing.push("actividad económica");
    if (!b.province || !b.canton || !b.district || !b.otherSigns) missing.push("ubicación del emisor");
    const co = await one<{ email: string | null }>(`SELECT email FROM companies WHERE id = fn_current_company()`);
    if (!co?.email) missing.push("correo de la empresa (Configuración → Empresa)");
    const secrets = await configuredSecrets();
    if (!secrets.has(SECRET.user) || !secrets.has(SECRET.password)) missing.push("usuario y clave del ATV");
    if (!secrets.has(SECRET.p12) || !secrets.has(SECRET.pin)) missing.push("llave criptográfica (.p12)");
    if (missing.length) throw badRequest("EINVOICE_INCOMPLETE", `Para activar los comprobantes falta: ${missing.join(", ")}`);
  }
  const wasContingency = (await settingsOf())?.contingency ?? false;
  await withTx(txCtx(req), (client) =>
    client.query(
      `INSERT INTO einvoice_settings (is_enabled, environment, activity_code, provider_id, province, canton, district, neighborhood, other_signs,
                                      service_unit, contingency, idp_url, api_url, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, fn_current_app_user())
       ON CONFLICT (company_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, environment = EXCLUDED.environment,
              activity_code = EXCLUDED.activity_code, provider_id = EXCLUDED.provider_id, province = EXCLUDED.province,
              canton = EXCLUDED.canton, district = EXCLUDED.district, neighborhood = EXCLUDED.neighborhood,
              other_signs = EXCLUDED.other_signs, service_unit = EXCLUDED.service_unit, contingency = EXCLUDED.contingency,
              idp_url = EXCLUDED.idp_url, api_url = EXCLUDED.api_url, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [
        b.isEnabled,
        b.environment,
        b.activityCode ?? null,
        b.providerId ?? null,
        b.province ?? null,
        b.canton ?? null,
        b.district ?? null,
        b.neighborhood || null,
        b.otherSigns ?? null,
        b.serviceUnit,
        b.contingency,
        b.idpUrl ?? null,
        b.apiUrl ?? null
      ]
    )
  );
  forgetTokens(currentCompanyId() ?? "");
  // Al salir de contingencia, lo que esperaba se envía ya
  if (wasContingency && !b.contingency) {
    await withTx(txCtx(req), (client) => client.query(`UPDATE einvoice_documents SET next_attempt_at = NOW() WHERE status = 'pending'`));
    kickQueue();
  }
  return settingsView();
});

const credentialsBody = z.object({
  username: z.string().trim().min(5).max(120),
  password: z.string().min(4).max(200)
});

export const saveEinvoiceCredentials = handler({ body: credentialsBody }, async ({ body, req }) => {
  await assertCostaRica();
  await withTx(txCtx(req), async (client) => {
    await writeSecret(client, SECRET.user, body.username, `…${body.username.slice(-12)}`);
    await writeSecret(client, SECRET.password, body.password, null);
  });
  forgetTokens(currentCompanyId() ?? "");
  return { configured: true, userHint: `…${body.username.slice(-12)}` };
});

const certificateBody = z.object({
  /** Contenido del .p12 en base64 */
  p12: z.string().trim().min(100).max(40_000).regex(/^[A-Za-z0-9+/=\s]+$/, "El archivo debe ir en base64"),
  pin: z.string().min(1).max(64)
});

export const saveEinvoiceCertificate = handler({ body: certificateBody }, async ({ body, req }) => {
  await assertCostaRica();
  const p12 = body.p12.replace(/\s+/g, "");
  let key;
  try {
    key = loadP12(Buffer.from(p12, "base64"), body.pin);
  } catch (err) {
    if (err instanceof SignerError) throw badRequest("INVALID_P12", err.message);
    throw err;
  }
  if (key.notAfter.getTime() < Date.now()) throw badRequest("CERT_EXPIRED", `El certificado venció el ${key.notAfter.toISOString().slice(0, 10)}`);
  await withTx(txCtx(req), async (client) => {
    await writeSecret(client, SECRET.p12, p12, null);
    await writeSecret(client, SECRET.pin, body.pin, null);
    await client.query(
      `INSERT INTO einvoice_settings (cert_subject, cert_expires_at, updated_by) VALUES ($1, $2, fn_current_app_user())
       ON CONFLICT (company_id) DO UPDATE SET cert_subject = EXCLUDED.cert_subject, cert_expires_at = EXCLUDED.cert_expires_at,
                                              updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [key.subject.slice(0, 300), key.notAfter]
    );
  });
  return { configured: true, subject: key.subject, expiresAt: key.notAfter.toISOString() };
});

/** Quita credenciales o llave; si los comprobantes estaban activos se desactivan */
const removeSecrets = (keys: string[]) =>
  handler({}, async ({ req }) => {
    await assertCostaRica();
    await withTx(txCtx(req), async (client) => {
      await client.query(`DELETE FROM company_secrets WHERE key = ANY($1)`, [keys]);
      await client.query(`UPDATE einvoice_settings SET is_enabled = FALSE, updated_by = fn_current_app_user(), updated_at = NOW()`);
      if (keys.includes(SECRET.p12)) await client.query(`UPDATE einvoice_settings SET cert_subject = NULL, cert_expires_at = NULL`);
    });
    forgetTokens(currentCompanyId() ?? "");
    return undefined;
  });

export const deleteEinvoiceCredentials = removeSecrets([SECRET.user, SECRET.password]);
export const deleteEinvoiceCertificate = removeSecrets([SECRET.p12, SECRET.pin]);

// ------------------------------------------------------------------ Rutas: comprobantes

const DOC_SELECT = `SELECT d.id, d.doc_type AS "docType", d.clave, d.consecutive, d.situation, d.environment, d.issued_at AS "issuedAt",
       d.total::float AS total, d.status, d.attempts, d.last_error AS "lastError", d.response_message AS "responseMessage",
       d.sale_id AS "saleId", v.ticket_number AS "ticketNumber", c.legal_name AS "customerName", c.rif AS "customerTaxId",
       r.clave AS "referenceClave", r.consecutive AS "referenceConsecutive", d.reason, d.sent_at AS "sentAt", d.decided_at AS "decidedAt",
       d.next_attempt_at AS "nextAttemptAt", (d.signed_xml IS NOT NULL) AS "hasXml", (d.response_xml IS NOT NULL) AS "hasResponse"
  FROM einvoice_documents d
  JOIN pos_sales v ON v.id = d.sale_id
  JOIN customers c ON c.id = v.customer_id
  LEFT JOIN einvoice_documents r ON r.id = d.reference_id`;

const docsQuery = pageQuery.extend({
  status: z.enum(["pending", "sent", "accepted", "rejected", "cancelled"]).optional(),
  docType: z.enum(["FE", "TE", "NC"]).optional(),
  search: z.string().trim().max(80).optional(),
  saleId: z.uuid().optional()
});

export const listEinvoiceDocuments = handler({ query: docsQuery }, async ({ query: q }) => {
  const rows = await query<{ total_rows?: number; docType: DocType }>(
    `SELECT COUNT(*) OVER()::int AS total_rows, x.* FROM (${DOC_SELECT}) x
      WHERE ($1::text IS NULL OR x.status = $1) AND ($2::text IS NULL OR x."docType" = $2)
        AND ($3::text IS NULL OR x.clave LIKE '%' || $3 || '%' OR x.consecutive LIKE '%' || $3 || '%' OR x."ticketNumber" ILIKE '%' || $3 || '%'
             OR x."customerName" ILIKE '%' || $3 || '%')
        AND ($4::uuid IS NULL OR x."saleId" = $4)
      ORDER BY x."issuedAt" DESC LIMIT $5 OFFSET $6`,
    [q.status ?? null, q.docType ?? null, q.search || null, q.saleId ?? null, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const total = rows[0]?.total_rows ?? 0;
  return { items: rows.map(({ total_rows: _t, ...r }) => ({ ...r, docName: DOC_NAMES[r.docType] })), total, page: q.page, pageSize: q.pageSize };
});

async function docDetail(id: string) {
  const doc = await one<{ docType: DocType }>(`${DOC_SELECT} WHERE d.id = $1`, [id]);
  if (!doc) throw notFound("Comprobante no encontrado");
  return { ...doc, docName: DOC_NAMES[doc.docType] };
}

export const getEinvoiceDocument = handler({ params: idParams }, async ({ params }) => docDetail(params.id));

/** XML firmado (o la respuesta de Hacienda con ?kind=response) para descargar */
export const getEinvoiceXml = handler(
  { params: idParams, query: z.object({ kind: z.enum(["signed", "response"]).default("signed") }) },
  async ({ params, query: q, res }) => {
    const row = await one<{ clave: string; xml: string | null }>(
      `SELECT clave, ${q.kind === "signed" ? "signed_xml" : "response_xml"} AS xml FROM einvoice_documents WHERE id = $1`,
      [params.id]
    );
    if (!row) throw notFound("Comprobante no encontrado");
    if (!row.xml) throw conflict("XML_NOT_READY", q.kind === "signed" ? "El comprobante aún no se ha firmado" : "Hacienda aún no ha respondido");
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${row.clave}${q.kind === "response" ? "-respuesta" : ""}.xml"`);
    res.send(row.xml);
    return undefined;
  }
);

/** Reintentar ya: envía (o consulta) este comprobante sin esperar a la cola */
export const retryEinvoiceDocument = handler({ params: idParams }, async ({ params, req }) => {
  const doc = await one<{ status: string }>(`SELECT status FROM einvoice_documents WHERE id = $1`, [params.id]);
  if (!doc) throw notFound("Comprobante no encontrado");
  if (doc.status !== "pending" && doc.status !== "sent") throw conflict("EINVOICE_FINAL", "El comprobante ya tiene respuesta definitiva de Hacienda");
  await withTx(txCtx(req), (client) => client.query(`UPDATE einvoice_documents SET next_attempt_at = NOW() WHERE id = $1`, [params.id]));
  await processDue(params.id, 1, true);
  return docDetail(params.id);
});

/** Procesa ya todo lo vencido de la cola de la empresa (botón «Procesar cola») */
export const processEinvoiceQueue = handler({}, async () => {
  await assertCostaRica();
  // Hasta tres pasadas: enviar y luego consultar el estado de lo recién enviado
  let processed = 0;
  for (let i = 0; i < 3; i++) {
    const n = await processDue(undefined, 25, true);
    processed += n;
    if (!n) break;
    if (i < 2) await new Promise((r) => setTimeout(r, 300));
  }
  const counts = await query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM einvoice_documents GROUP BY status`);
  return { processed, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
});
