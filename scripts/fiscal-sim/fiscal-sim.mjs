#!/usr/bin/env node
/**
 * @project FabriHub
 * @file scripts/fiscal-sim/fiscal-sim.mjs
 * @description Simuladores del documento fiscal de Venezuela (fase 19), sin dependencias:
 *   · agente local de impresora fiscal (protocolo 1 de FabriHub), para la PC de la caja;
 *   · API genérica de imprenta digital (la que consume el adaptador de la API).
 *
 *   · Hacienda de Costa Rica (IdP + API de recepción v4.4) para los comprobantes electrónicos (fase 18).
 *
 * Uso:  node scripts/fiscal-sim/fiscal-sim.mjs [agent|digital|hacienda|all] [--host 127.0.0.1]
 *         [--agent-port 7788] [--digital-port 7789] [--hacienda-port 7790] [--serial Z1F0000001]
 *         [--key clave-simulada] [--atv-user U --atv-password P]  (sin ellos, Hacienda acepta cualquier usuario)
 *
 * Cada simulador tiene POST /_sim para provocar fallas en las pruebas (sin autenticación: no publicarlo):
 *   agente   { failNext: "Sin papel" | null, offline: true | false }
 *   digital  { failNext: "down" | "reject" | null, down: true | false }
 *   hacienda { rejectNext: true | false }   y GET /_sim con lo recibido y su verificación de firma
 *
 * ── Protocolo del agente (lo que un agente real debe implementar para su marca de impresora) ──
 *   GET  /v1/status       → { protocol: 1, driver, model, serial, ready, message?, zNumber, lastInvoice, lastCreditNote }
 *   POST /v1/documents    ← FiscalPayload (api/src/modules/fiscal/protocol.ts), idempotente por `id`
 *                         → { documentNumber, machineSerial, zNumber, issuedAt }
 *                           errores: { error: { code, message } } con 4xx (documento inválido) o 503 (impresora)
 *   POST /v1/reports/x    → totales del día sin cerrar
 *   POST /v1/reports/z    → cierra el día: { machineSerial, zNumber, reportDate, firstInvoice, lastInvoice,
 *                           lastCreditNote, invoicesCount, creditNotesCount, totals }
 *   CORS abierto y Access-Control-Allow-Private-Network (el navegador llama desde la página de la app).
 *
 * ── API de imprenta digital (contrato genérico, ver api/src/modules/fiscal/digital.ts) ──
 *   GET  /v1/status       (Bearer) → { ok: true, provider }
 *   POST /v1/documents    (Bearer, Idempotency-Key) ← FiscalPayload
 *                         → 201 { documentNumber, controlNumber, issuedAt, pdfBase64 }; 409 mismo cuerpo si ya existía
 */

import { createHash, createVerify, X509Certificate } from "node:crypto";
import http from "node:http";

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n, w = 8) => String(n).padStart(w, "0");
const today = () => new Date().toISOString().slice(0, 10);

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** Validación común del documento canónico: cuadra líneas, impuestos y total */
export function validatePayload(doc) {
  if (!doc || doc.protocol !== 1) return "Protocolo no soportado (se espera 1)";
  if (!doc.id || !["invoice", "credit_note"].includes(doc.type)) return "Documento sin id o de tipo desconocido";
  if (!Array.isArray(doc.lines) || !doc.lines.length) return "El documento no tiene líneas";
  if (doc.type === "credit_note" && !(doc.reference?.documentNumber || doc.reference?.controlNumber)) {
    return "La nota de crédito debe indicar la factura que afecta";
  }
  const net = r2(doc.lines.reduce((a, l) => a + l.net, 0));
  const tax = r2(doc.lines.reduce((a, l) => a + l.tax, 0));
  if (Math.abs(net + tax - doc.totals.total) > 0.05) return `Las líneas (${r2(net + tax)}) no cuadran con el total (${doc.totals.total})`;
  const igtf = doc.totals.igtf?.amount ?? 0;
  if (Math.abs(doc.totals.total + igtf - doc.totals.grandTotal) > 0.01) return "El total a pagar no incluye el IGTF";
  return null;
}

// ------------------------------------------------------------------ Impresora fiscal (agente local)

export function startAgent({ port = 7788, host = "127.0.0.1", serial = "Z1F0000001", model = "Impresora fiscal simulada" } = {}) {
  const state = {
    serial,
    zNumber: 1,
    lastInvoice: 0,
    lastCreditNote: 0,
    /** Próxima impresión falla con este mensaje (p. ej. «Sin papel») */
    failNext: null,
    offline: false,
    printed: new Map(),
    day: { firstInvoice: null, invoices: 0, creditNotes: 0, sales: 0, exempt: 0, taxes: new Map(), creditTotal: 0, igtf: 0 }
  };

  const totals = () => ({
    sales: r2(state.day.sales),
    exempt: r2(state.day.exempt),
    taxes: [...state.day.taxes.entries()].map(([rate, t]) => ({ rate, base: r2(t.base), amount: r2(t.amount) })),
    creditNotes: r2(state.day.creditTotal),
    igtf: r2(state.day.igtf)
  });
  const report = () => ({
    machineSerial: state.serial,
    zNumber: state.zNumber,
    reportDate: today(),
    firstInvoice: state.day.firstInvoice,
    lastInvoice: state.lastInvoice ? pad(state.lastInvoice) : null,
    lastCreditNote: state.lastCreditNote ? pad(state.lastCreditNote) : null,
    invoicesCount: state.day.invoices,
    creditNotesCount: state.day.creditNotes,
    totals: totals()
  });

  const server = http.createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
      vary: "origin"
    };
    if (req.method === "OPTIONS") return send(res, 204, undefined, cors);
    if (req.method === "POST" && req.url === "/_sim") {
      const b = (await readJson(req)) ?? {};
      if ("failNext" in b) state.failNext = b.failNext || null;
      if ("offline" in b) state.offline = Boolean(b.offline);
      return send(res, 200, { failNext: state.failNext, offline: state.offline }, cors);
    }
    if (state.offline) {
      req.socket.destroy();
      return;
    }
    const path = new URL(req.url, "http://agent").pathname;
    if (req.method === "GET" && path === "/v1/status") {
      return send(res, 200, { protocol: 1, driver: "simulator", model, serial: state.serial, ready: !state.failNext, message: state.failNext, zNumber: state.zNumber, lastInvoice: state.lastInvoice ? pad(state.lastInvoice) : null, lastCreditNote: state.lastCreditNote ? pad(state.lastCreditNote) : null }, cors);
    }
    if (req.method === "POST" && path === "/v1/documents") {
      const doc = await readJson(req);
      const invalid = validatePayload(doc);
      if (invalid) return send(res, 422, { error: { code: "INVALID_DOCUMENT", message: invalid } }, cors);
      // Reintento del mismo documento: la máquina no lo imprime dos veces
      if (state.printed.has(doc.id)) return send(res, 200, state.printed.get(doc.id).result, cors);
      if (state.failNext) {
        const message = state.failNext;
        state.failNext = null;
        return send(res, 503, { error: { code: "PRINTER_ERROR", message } }, cors);
      }
      const isInvoice = doc.type === "invoice";
      const n = isInvoice ? ++state.lastInvoice : ++state.lastCreditNote;
      const result = { documentNumber: pad(n), machineSerial: state.serial, zNumber: state.zNumber, issuedAt: new Date().toISOString() };
      state.printed.set(doc.id, { doc, result });
      if (isInvoice) {
        state.day.invoices++;
        state.day.firstInvoice ??= pad(n);
        state.day.sales += doc.totals.total;
        state.day.exempt += doc.totals.exempt;
        state.day.igtf += doc.totals.igtf?.amount ?? 0;
        for (const t of doc.totals.taxes) {
          const acc = state.day.taxes.get(t.rate) ?? { base: 0, amount: 0 };
          state.day.taxes.set(t.rate, { base: acc.base + t.base, amount: acc.amount + t.amount });
        }
      } else {
        state.day.creditNotes++;
        state.day.creditTotal += doc.totals.total;
      }
      return send(res, 200, result, cors);
    }
    if (req.method === "POST" && path === "/v1/reports/x") return send(res, 200, report(), cors);
    if (req.method === "POST" && path === "/v1/reports/z") {
      const z = report();
      state.zNumber++;
      state.day = { firstInvoice: null, invoices: 0, creditNotes: 0, sales: 0, exempt: 0, taxes: new Map(), creditTotal: 0, igtf: 0 };
      return send(res, 200, z, cors);
    }
    send(res, 404, { error: { code: "NOT_FOUND", message: "Ruta desconocida" } }, cors);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, state, url: `http://${host}:${port}` })));
}

// ------------------------------------------------------------------ Imprenta digital

/** PDF mínimo (una página, Helvetica) con las líneas dadas */
export function tinyPdf(lines) {
  const esc = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const text = lines.map((l, i) => `BT /F1 11 Tf 40 ${800 - i * 16} Td (${esc(l)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function startDigital({ port = 7789, host = "127.0.0.1", apiKey = "clave-simulada", provider = "Imprenta digital simulada" } = {}) {
  const state = {
    control: 0,
    numbers: { invoice: 0, credit_note: 0 },
    issued: new Map(),
    /** Próximo envío: «down» = 503, «reject» = 422 */
    failNext: null,
    down: false,
    requests: 0
  };
  const server = http.createServer(async (req, res) => {
    state.requests++;
    if (req.method === "POST" && req.url === "/_sim") {
      const b = (await readJson(req)) ?? {};
      if ("failNext" in b) state.failNext = b.failNext || null;
      if ("down" in b) state.down = Boolean(b.down);
      return send(res, 200, { failNext: state.failNext, down: state.down, issued: state.issued.size });
    }
    const path = new URL(req.url, "http://digital").pathname;
    if (req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { error: { message: "Clave de API inválida" } });
    if (state.down) return send(res, 503, { error: { message: "Servicio en mantenimiento" } });
    if (req.method === "GET" && path === "/v1/status") return send(res, 200, { ok: true, provider });
    if (req.method === "POST" && path === "/v1/documents") {
      const doc = await readJson(req);
      if (!doc || req.headers["idempotency-key"] !== doc.id) return send(res, 400, { error: { message: "Idempotency-Key no coincide con el documento" } });
      const prev = state.issued.get(doc.id);
      if (prev) return send(res, 409, prev.result);
      const invalid = validatePayload(doc);
      if (invalid) return send(res, 422, { error: { message: invalid } });
      if (state.failNext === "down") {
        state.failNext = null;
        return send(res, 503, { error: { message: "Servicio no disponible" } });
      }
      if (state.failNext === "reject") {
        state.failNext = null;
        return send(res, 422, { error: { message: "RIF del cliente no válido" } });
      }
      const number = ++state.numbers[doc.type];
      const controlNumber = `00-${pad(++state.control)}`;
      const issuedAt = new Date().toISOString();
      const pdf = tinyPdf([
        provider,
        `${doc.type === "invoice" ? "FACTURA" : "NOTA DE CREDITO"} N. ${pad(number)}   Control ${controlNumber}`,
        `${doc.issuer.name} - RIF ${doc.issuer.taxId}`,
        doc.customer ? `Cliente: ${doc.customer.name} - ${doc.customer.taxId}` : "Consumidor final",
        ...doc.lines.map((l) => `${l.quantity} x ${l.description} (${l.taxMark})  ${l.net.toFixed(2)}`),
        doc.totals.igtf ? `IGTF ${doc.totals.igtf.rate}%: ${doc.totals.igtf.amount.toFixed(2)}` : "",
        `TOTAL ${doc.currency} ${doc.totals.grandTotal.toFixed(2)}`,
        doc.contingency ? `Emitida en contingencia: formato ${doc.contingency.formNumber}` : "",
        doc.reference ? `Afecta a la factura ${doc.reference.documentNumber ?? doc.reference.controlNumber}` : ""
      ].filter(Boolean));
      const result = { documentNumber: pad(number), controlNumber, issuedAt, pdfBase64: pdf.toString("base64") };
      state.issued.set(doc.id, { doc, result });
      return send(res, 201, result);
    }
    send(res, 404, { error: { message: "Ruta desconocida" } });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, state, url: `http://${host}:${port}` })));
}

// ------------------------------------------------------------------ Hacienda de Costa Rica

const tag = (xml, name) => new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;

/** Verificación independiente: digest del documento, firma RSA de SignedInfo y política v4.4 */
export function verifySignedXml(xml) {
  try {
    const ns = /^<\?xml[^>]*\?><\w+ xmlns="([^"]+)">/.exec(xml)?.[1];
    const body = xml.replace(/^<\?xml[^>]*\?>/, "").replace(/<ds:Signature [\s\S]*<\/ds:Signature>/, "");
    const docDigest = /<ds:Reference Id="Reference-[^"]+" URI="">[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/.exec(xml)?.[1];
    const digestOk = createHash("sha256").update(body).digest("base64") === docDigest;
    const signedInfo = /<ds:SignedInfo>[\s\S]*?<\/ds:SignedInfo>/.exec(xml)?.[0] ?? "";
    const c14n = signedInfo.replace("<ds:SignedInfo>", `<ds:SignedInfo xmlns="${ns}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">`);
    const cert = new X509Certificate(Buffer.from(tag(xml, "ds:X509Certificate") ?? "", "base64"));
    const signatureOk = createVerify("RSA-SHA256").update(c14n).verify(cert.publicKey, tag(xml, "ds:SignatureValue") ?? "", "base64");
    const policyOk = xml.includes("<ds:DigestValue>DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=</ds:DigestValue>");
    return { digestOk, signatureOk, policyOk };
  } catch (err) {
    return { digestOk: false, signatureOk: false, policyOk: false, error: err.message };
  }
}

const mensajeHacienda = (clave, ok, detail) =>
  `<?xml version="1.0" encoding="UTF-8"?><MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">` +
  `<Clave>${clave}</Clave><NombreEmisor>Emisor</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>` +
  `<NumeroCedulaEmisor>${clave.slice(9, 21).replace(/^0+/, "")}</NumeroCedulaEmisor><Mensaje>${ok ? 1 : 3}</Mensaje><DetalleMensaje>${detail}</DetalleMensaje>` +
  `<MontoTotalImpuesto>0</MontoTotalImpuesto><TotalFactura>0</TotalFactura></MensajeHacienda>`;

/**
 * IdP en /idp/token (grant password, client_id api-stag) y recepción en /api/recepcion.
 * En la empresa: ambiente de pruebas, IdP = {url}/idp/token y recepción = {url}/api.
 * Un comprobante con firma inválida se rechaza; el primer GET de estado responde «procesando».
 */
export function startHacienda({ port = 7790, host = "127.0.0.1", user = null, password = null } = {}) {
  const state = { tokens: 0, badLogins: 0, received: new Map(), polls: new Map(), rejectNext: false, rejected: new Set() };
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url, "http://hacienda");
    if (url.pathname === "/_sim" && req.method === "POST") {
      const b = raw ? JSON.parse(raw) : {};
      if ("rejectNext" in b) state.rejectNext = Boolean(b.rejectNext);
      return send(res, 200, { rejectNext: state.rejectNext });
    }
    if (url.pathname === "/_sim" && req.method === "GET") {
      const received = [...state.received.values()].map((r) => ({ clave: r.clave, verify: r.verify, rejected: state.rejected.has(r.clave) }));
      return send(res, 200, { tokens: state.tokens, badLogins: state.badLogins, received });
    }
    if (url.pathname === "/idp/token" && req.method === "POST") {
      const f = new URLSearchParams(raw);
      const okUser = user ? f.get("username") === user && f.get("password") === password : Boolean(f.get("username") && f.get("password"));
      if (f.get("grant_type") !== "password" || f.get("client_id") !== "api-stag" || !okUser) {
        state.badLogins++;
        return send(res, 401, { error: "invalid_grant", error_description: "Invalid user credentials" });
      }
      state.tokens++;
      return send(res, 200, { access_token: `tok-${state.tokens}`, expires_in: 300, refresh_token: "r" });
    }
    const authorized = /^Bearer tok-\d+$/.test(req.headers.authorization ?? "");
    if (url.pathname === "/api/recepcion" && req.method === "POST") {
      if (!authorized) return send(res, 401, {});
      const b = JSON.parse(raw);
      if (state.received.has(b.clave)) {
        res.writeHead(400, { "x-error-cause": "El comprobante ya fue recibido anteriormente" });
        return res.end();
      }
      const xml = Buffer.from(b.comprobanteXml, "base64").toString("utf8");
      const verify = verifySignedXml(xml);
      state.received.set(b.clave, { clave: b.clave, xml, verify });
      if (state.rejectNext || !verify.digestOk || !verify.signatureOk || !verify.policyOk) {
        state.rejected.add(b.clave);
        state.rejectNext = false;
      }
      res.writeHead(202);
      return res.end();
    }
    const st = /^\/api\/recepcion\/(\d{50})$/.exec(url.pathname);
    if (st && req.method === "GET") {
      if (!authorized) return send(res, 401, {});
      const r = state.received.get(st[1]);
      if (!r) return send(res, 404, {});
      const n = (state.polls.get(r.clave) ?? 0) + 1;
      state.polls.set(r.clave, n);
      if (n === 1) return send(res, 200, { clave: r.clave, "ind-estado": "procesando" });
      const ok = !state.rejected.has(r.clave);
      const v = r.verify;
      const badSignature = !v.signatureOk || !v.digestOk || !v.policyOk;
      const detail = ok ? "Comprobante aceptado (Hacienda simulado)" : badSignature ? "Rechazo simulado: la firma no es válida" : "Rechazo simulado a pedido de la prueba";
      const respuesta = Buffer.from(mensajeHacienda(r.clave, ok, detail)).toString("base64");
      return send(res, 200, { clave: r.clave, "ind-estado": ok ? "aceptado" : "rechazado", "respuesta-xml": respuesta });
    }
    send(res, 404, {});
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, state, url: `http://${host}:${port}` })));
}

// ------------------------------------------------------------------ Línea de comandos

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/fiscal-sim.mjs")) {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const mode = args[0] && !args[0].startsWith("--") ? args[0] : "all";
  const all = mode === "all" || mode === "both";
  const host = opt("host", "127.0.0.1");
  if (mode === "agent" || all) {
    const a = await startAgent({ host, port: Number(opt("agent-port", 7788)), serial: opt("serial", "Z1F0000001") });
    console.log(`Agente de impresora fiscal simulada en ${a.url} (serial ${a.state.serial})`);
  }
  if (mode === "digital" || all) {
    const d = await startDigital({ host, port: Number(opt("digital-port", 7789)), apiKey: opt("key", "clave-simulada") });
    console.log(`Imprenta digital simulada en ${d.url}/  (clave de API: la indicada con --key)`);
  }
  if (mode === "hacienda" || all) {
    const h = await startHacienda({ host, port: Number(opt("hacienda-port", 7790)), user: opt("atv-user", null), password: opt("atv-password", null) });
    console.log(`Hacienda simulado en ${h.url}  (IdP ${h.url}/idp/token, recepción ${h.url}/api)`);
  }
}
