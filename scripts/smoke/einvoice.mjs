/**
 * @project FabriHub
 * @file scripts/smoke/einvoice.mjs
 * @description Fase 18: comprobantes electrónicos de Costa Rica (v4.4). Configuración, llave .p12 de
 * prueba (autofirmada, PIN 1234, en fixtures/), tiquete y factura desde el POS, nota de crédito al
 * anular, rechazo de Hacienda y modo contingencia.
 *
 * Hacienda (IdP y API de recepción) se simula con un servidor HTTP en el contenedor de pruebas (alias
 * «smoke-runner»); la API acepta esas URL solo fuera de producción. El simulador verifica el token,
 * el digest del documento y la firma RSA de cada XML recibido.
 */

import { createHash, createVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { adminSession, call, check, closeSessionAsExpected, section } from "./_client.mjs";

const PORT = 18998;
const MOCK = `http://smoke-runner:${PORT}`;
const T = Date.now().toString(36).toUpperCase().slice(-6);
const ATV_USER = "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr";
const ATV_PASSWORD = "clave-de-pruebas";
const P12 = readFileSync(new URL("./fixtures/einvoice-test.p12", import.meta.url)).toString("base64");

/** Estado del simulador */
const mock = { tokens: 0, badLogins: 0, received: new Map(), polls: new Map(), rejectNext: false, rejected: new Set() };

const tag = (xml, name) => new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;

/** Verificación independiente del simulador: digest del documento y firma de SignedInfo */
function verify(xml) {
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
}

const respuesta = (clave, ok, detail) =>
  `<?xml version="1.0" encoding="UTF-8"?><MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">` +
  `<Clave>${clave}</Clave><NombreEmisor>Tienda Tica</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor>` +
  `<NumeroCedulaEmisor>3101123456</NumeroCedulaEmisor><Mensaje>${ok ? 1 : 3}</Mensaje><DetalleMensaje>${detail}</DetalleMensaje>` +
  `<MontoTotalImpuesto>0</MontoTotalImpuesto><TotalFactura>0</TotalFactura></MensajeHacienda>`;

function startMock() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, MOCK);
      const json = (status, body) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/idp/token" && req.method === "POST") {
        const f = new URLSearchParams(raw);
        if (f.get("grant_type") !== "password" || f.get("client_id") !== "api-stag" || f.get("username") !== ATV_USER || f.get("password") !== ATV_PASSWORD) {
          mock.badLogins++;
          return json(401, { error: "invalid_grant", error_description: "Invalid user credentials" });
        }
        mock.tokens++;
        return json(200, { access_token: `tok-${mock.tokens}`, expires_in: 300, refresh_token: "r" });
      }
      const authorized = /^Bearer tok-\d+$/.test(req.headers.authorization ?? "");
      if (url.pathname === "/api/recepcion" && req.method === "POST") {
        if (!authorized) return json(401, {});
        const b = JSON.parse(raw);
        const xml = Buffer.from(b.comprobanteXml, "base64").toString("utf8");
        if (mock.received.has(b.clave)) {
          res.statusCode = 400;
          res.setHeader("x-error-cause", "El comprobante ya fue recibido anteriormente");
          return res.end();
        }
        mock.received.set(b.clave, { ...b, xml, verify: verify(xml) });
        if (mock.rejectNext) {
          mock.rejected.add(b.clave);
          mock.rejectNext = false;
        }
        res.statusCode = 202;
        return res.end();
      }
      const st = /^\/api\/recepcion\/(\d{50})$/.exec(url.pathname);
      if (st && req.method === "GET") {
        if (!authorized) return json(401, {});
        const clave = st[1];
        if (!mock.received.has(clave)) return json(404, {});
        const n = (mock.polls.get(clave) ?? 0) + 1;
        mock.polls.set(clave, n);
        if (n === 1) return json(200, { clave, "ind-estado": "procesando" });
        const ok = !mock.rejected.has(clave);
        const detail = ok ? "Comprobante aceptado" : "Rechazo de prueba: la actividad económica no corresponde";
        return json(200, { clave, "ind-estado": ok ? "aceptado" : "rechazado", "respuesta-xml": Buffer.from(respuesta(clave, ok, detail)).toString("base64") });
      }
      res.statusCode = 404;
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(PORT, "0.0.0.0", () => resolve(server)));
}

export async function run() {
  const admin = await adminSession();
  const server = await startMock();
  const companyVE = (await call("GET", "/auth/me", { token: admin })).json.company;

  section("Solo en Costa Rica");
  const ve = await call("GET", "/einvoice/settings", { token: admin });
  check("Venezuela no usa comprobantes de Hacienda → 400", ve.code === "EINVOICE_NOT_AVAILABLE", ve.json);

  const cr = (await call("GET", "/admin/companies", { token: admin })).json.find((c) => c.countryCode === "CR");
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: cr.id } });
  let session = null;
  const settingsBody = {
    isEnabled: true,
    environment: "sandbox",
    activityCode: "620100",
    province: 1,
    canton: "01",
    district: "03",
    neighborhood: "Barrio Amón",
    otherSigns: "200 m al norte del parque Morazán",
    serviceUnit: "Sp",
    contingency: false,
    idpUrl: `${MOCK}/idp/token`,
    apiUrl: `${MOCK}/api`
  };
  try {
    section("Configuración y credenciales");
    const st0 = (await call("GET", "/einvoice/settings", { token: admin })).json;
    check("nace apagado, en el ambiente de pruebas y sin credenciales", st0?.isEnabled === false && st0?.environment === "sandbox" && !st0?.credentials?.configured && !st0?.certificate?.configured, st0);
    const early = await call("PUT", "/einvoice/settings", { token: admin, body: settingsBody });
    check("activar sin llave ni usuario del ATV → 400 con lo que falta", early.code === "EINVOICE_INCOMPLETE" && /ATV/.test(early.json?.error?.message ?? ""), early.json);

    const badPin = await call("PUT", "/einvoice/certificate", { token: admin, body: { p12: P12, pin: "0000" } });
    check("PIN incorrecto de la llave .p12 → 400", badPin.code === "INVALID_P12", badPin.json);
    const notP12 = await call("PUT", "/einvoice/certificate", { token: admin, body: { p12: Buffer.from("no es una llave".repeat(10)).toString("base64"), pin: "1234" } });
    check("archivo que no es .p12 → 400", notP12.code === "INVALID_P12", notP12.json);
    const cert = await call("PUT", "/einvoice/certificate", { token: admin, body: { p12: P12, pin: "1234" } });
    check("carga la llave: titular y vencimiento", cert.status === 200 && /FABRIHUB PRUEBAS/.test(cert.json?.subject ?? "") && cert.json?.expiresAt, cert.json);
    const creds = await call("PUT", "/einvoice/credentials", { token: admin, body: { username: ATV_USER, password: ATV_PASSWORD } });
    check("guarda el usuario del ATV (solo se muestra el final)", creds.status === 200 && creds.json?.userHint?.startsWith("…") && !JSON.stringify(creds.json).includes(ATV_PASSWORD), creds.json);

    const company = (await call("GET", "/settings/company", { token: admin })).json;
    await call("PUT", "/settings/company", { token: admin, body: { ...company, email: "" } });
    const noEmail = await call("PUT", "/einvoice/settings", { token: admin, body: settingsBody });
    check("sin correo de la empresa no se activa", noEmail.code === "EINVOICE_INCOMPLETE" && /correo/.test(noEmail.json?.error?.message ?? ""), noEmail.json);
    await call("PUT", "/settings/company", { token: admin, body: { ...company, email: "facturas@tiendatica.cr" } });
    const badActivity = await call("PUT", "/einvoice/settings", { token: admin, body: { ...settingsBody, activityCode: "6201" } });
    check("actividad económica de 4 dígitos → 400", badActivity.status === 400, badActivity.json);
    const on = await call("PUT", "/einvoice/settings", { token: admin, body: settingsBody });
    check("activa los comprobantes electrónicos", on.status === 200 && on.json?.isEnabled === true && on.json?.certificate?.configured && on.json?.credentials?.configured, on.json);
    check("la respuesta nunca trae secretos", !JSON.stringify(on.json).includes(ATV_PASSWORD) && !JSON.stringify(on.json).includes(P12.slice(0, 40)));

    section("Caja y producto");
    const lookup = async (k) => (await call("GET", `/lookups/${k}`, { token: admin })).json;
    const [types, units, treatments, currencies] = await Promise.all([lookup("product-types"), lookup("units"), lookup("fiscal-treatments"), lookup("currencies")]);
    const CRC = currencies.find((c) => c.code === "CRC");
    const wh = await call("POST", "/inventory/warehouses", { token: admin, body: { code: `FE${T}`, name: "Tienda FE", kind: "storage" } });
    const product = await call("POST", "/inventory/products", {
      token: admin,
      body: {
        code: `SRV-FE-${T}`,
        name: "Soporte técnico por hora",
        productTypeId: (types.find((x) => x.code === "PT") ?? types[0]).id,
        stockUnitId: units.find((u) => u.code === "UND").id,
        isStockable: false,
        isSold: true,
        salePrice: 25000,
        fiscalTreatmentId: treatments.find((x) => x.code === "G13").id
      }
    });
    check("servicio con IVA 13 %", product.status === 201, product.json);
    const term = await call("POST", "/pos/terminals", { token: admin, body: { code: `FE${T}`, name: "Caja electrónica", warehouseId: wh.json.id, einvBranch: 2, einvTerminal: 7 } });
    check("caja con sucursal 002 y terminal 00007", term.status === 201 && term.json?.einvBranch === 2 && term.json?.einvTerminal === 7, term.json);
    const leftover = (await call("GET", "/pos/me", { token: admin })).json?.session;
    if (leftover?.id) await closeSessionAsExpected(admin, leftover.id);
    const opened = await call("POST", "/pos/sessions", { token: admin, body: { terminalId: term.json.id } });
    check("abre el turno", opened.status === 201, opened.json);
    session = opened.json;
    const sell = (customerId, amount = 30000, extra = {}) =>
      call("POST", "/pos/sales", {
        token: admin,
        body: { sessionId: session.id, customerId, lines: [{ productId: product.json.id, quantity: 1 }], payments: [{ method: "cash", currencyId: CRC.id, amount }], ...extra }
      });

    const noCabys = await sell(null);
    check("sin código CABYS la venta no se confirma → 400", noCabys.code === "CABYS_MISSING" && noCabys.json?.error?.message?.includes(`SRV-FE-${T}`), noCabys.json);
    const badCabys = await call("PATCH", `/inventory/products/${product.json.id}`, { token: admin, body: { cabysCode: "12345" } });
    check("CABYS de 5 dígitos → 400", badCabys.status === 400, badCabys.json);
    const cabys = await call("PATCH", `/inventory/products/${product.json.id}`, { token: admin, body: { cabysCode: "8314100000100" } });
    check("guarda el CABYS del producto", cabys.json?.cabysCode === "8314100000100", cabys.json);

    section("Tiquete electrónico (consumidor final)");
    const retry = (id) => call("POST", `/einvoice/documents/${id}/retry`, { token: admin });
    const settle = async (id, until = ["accepted", "rejected", "cancelled"]) => {
      let d = null;
      for (let i = 0; i < 6; i++) {
        d = (await retry(id)).json;
        if (until.includes(d?.status)) break;
      }
      return d;
    };
    const te = await sell(null);
    const teDoc = te.json?.einvoices?.[0];
    check("la venta reserva un tiquete electrónico", te.status === 201 && teDoc?.docType === "TE" && teDoc?.status && teDoc.docName === "Tiquete electrónico", te.json?.einvoices ?? te.json);
    check("consecutivo: sucursal 002, terminal 00007, tipo 04, número 1", teDoc?.consecutive === "00200007040000000001", teDoc?.consecutive);
    const ddmmyy = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Costa_Rica", day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date()).replace(/\//g, "");
    check(
      "clave de 50: 506 + fecha + cédula (12) + consecutivo + situación normal + código de seguridad",
      /^\d{50}$/.test(teDoc?.clave ?? "") && teDoc.clave.startsWith(`506${ddmmyy}003101123456${teDoc.consecutive}1`),
      teDoc?.clave
    );
    const teDone = await settle(teDoc.id);
    const recTE = mock.received.get(teDoc.clave);
    check("se envía a Hacienda con el token del ATV (ambiente de pruebas)", Boolean(recTE) && mock.tokens >= 1 && recTE.emisor?.numeroIdentificacion === "3101123456" && !recTE.receptor, recTE && { emisor: recTE.emisor, receptor: recTE.receptor });
    check("XML 4.4 de tiquete con la clave y el consecutivo", /<TiqueteElectronico xmlns="https:\/\/cdn\.comprobanteselectronicos\.go\.cr\/xml-schemas\/v4\.4\/tiqueteElectronico">/.test(recTE?.xml ?? "") && recTE.xml.includes(`<Clave>${teDoc.clave}</Clave>`));
    check("firma XAdES-EPES válida (digest, RSA-SHA256 y política 4.4)", recTE?.verify?.digestOk && recTE.verify.signatureOk && recTE.verify.policyOk, recTE?.verify);
    check(
      "línea con CABYS, unidad de servicio, IVA 13 % (tarifa 08) y total 28 250",
      recTE?.xml.includes("<CodigoCABYS>8314100000100</CodigoCABYS>") && recTE.xml.includes("<UnidadMedida>Sp</UnidadMedida>") &&
        recTE.xml.includes("<CodigoTarifaIVA>08</CodigoTarifaIVA><Tarifa>13.00</Tarifa><Monto>3250.00000</Monto>") && recTE.xml.includes("<TotalComprobante>28250.00000</TotalComprobante>")
    );
    check("medio de pago efectivo por el total (sin el vuelto)", recTE?.xml.includes("<MedioPago><TipoMedioPago>01</TipoMedioPago><TotalMedioPago>28250.00000</TotalMedioPago></MedioPago>"));
    check("Hacienda lo acepta (tras «procesando»)", teDone?.status === "accepted" && teDone?.responseMessage === "Comprobante aceptado" && teDone?.hasResponse, teDone);
    const xmlRes = await call("GET", `/einvoice/documents/${teDoc.id}/xml`, { token: admin });
    check("descarga el XML firmado", xmlRes.status === 200 && xmlRes.json?.raw?.startsWith('<?xml version="1.0" encoding="utf-8"?><TiqueteElectronico '), xmlRes.json?.raw);
    const ticket = (await call("GET", `/pos/sales/${te.json.id}/ticket`, { token: admin })).json;
    check(
      "el ticket es la representación impresa: tipo, consecutivo y clave (sin QR)",
      ticket?.legends?.[0] === "TIQUETE ELECTRÓNICO" && ticket?.einvoice?.clave === teDoc.clave && ticket?.einvoice?.consecutive === teDoc.consecutive && ticket?.einvoice?.status === "accepted",
      { legends: ticket?.legends, einvoice: ticket?.einvoice }
    );
    const te2 = await sell(null);
    check("el siguiente tiquete de la caja es el número 2", te2.json?.einvoices?.[0]?.consecutive === "00200007040000000002", te2.json?.einvoices?.[0]?.consecutive);
    await settle(te2.json.einvoices[0].id);

    section("Factura electrónica y nota de crédito");
    const customer = await call("POST", "/pos/customers", { token: admin, body: { rif: "112345678", name: "María Rodríguez Mora" } });
    check("cliente con cédula física", customer.status === 201 && customer.json?.idType === "FISICA", customer.json);
    const fe = await sell(customer.json.id);
    const feDoc = fe.json?.einvoices?.[0];
    check("cliente identificado → factura electrónica (tipo 01, número 1)", feDoc?.docType === "FE" && feDoc.consecutive === "00200007010000000001", feDoc);
    const feDone = await settle(feDoc.id);
    const recFE = mock.received.get(feDoc.clave);
    check(
      "la factura lleva al receptor (cédula física 01) y su firma es válida",
      recFE?.receptor?.tipoIdentificacion === "01" && recFE.receptor.numeroIdentificacion === "112345678" &&
        recFE.xml.includes("<Receptor><Nombre>María Rodríguez Mora</Nombre><Identificacion><Tipo>01</Tipo><Numero>112345678</Numero></Identificacion>") &&
        recFE.verify.signatureOk && recFE.verify.digestOk,
      recFE && { receptor: recFE.receptor, verify: recFE.verify }
    );
    check("factura aceptada", feDone?.status === "accepted", feDone);
    const voided = await call("POST", `/pos/sales/${fe.json.id}/void`, { token: admin, body: { reason: "Cliente devolvió el servicio" } });
    const nc = voided.json?.einvoices?.find?.((d) => d.docType === "NC");
    check("anular no borra el comprobante: emite una nota de crédito (tipo 03)", voided.json?.status === "voided" && nc?.consecutive === "00200007030000000001", voided.json?.einvoices);
    const ncDone = await settle(nc.id);
    const recNC = mock.received.get(nc.clave);
    check(
      "la nota referencia a la factura (01, clave, código 01 «anula») con el motivo",
      recNC?.xml.includes(`<InformacionReferencia><TipoDocIR>01</TipoDocIR><Numero>${feDoc.clave}</Numero>`) &&
        recNC.xml.includes("<Codigo>01</Codigo><Razon>Cliente devolvió el servicio</Razon>") && recNC.verify.signatureOk,
      recNC?.xml?.match(/<InformacionReferencia>.*<\/InformacionReferencia>/)?.[0]
    );
    check("nota de crédito aceptada y en la lista de comprobantes", ncDone?.status === "accepted" && ncDone?.referenceClave === feDoc.clave, ncDone);
    const tVoid = (await call("GET", `/pos/sales/${fe.json.id}/ticket`, { token: admin })).json;
    check("el ticket de la venta anulada muestra la nota de crédito", tVoid?.einvoice?.docType === "FE" && tVoid?.einvoice?.creditNote?.clave === nc.clave, tVoid?.einvoice);

    section("Rechazo de Hacienda");
    mock.rejectNext = true;
    const bad = await sell(null);
    const badDoc = await settle(bad.json.einvoices[0].id);
    check("rechazado, con el motivo del MensajeHacienda", badDoc?.status === "rejected" && /actividad económica/.test(badDoc?.responseMessage ?? ""), badDoc);
    const badVoid = await call("POST", `/pos/sales/${bad.json.id}/void`, { token: admin, body: { reason: "Se rehace la venta" } });
    check("anular una venta con comprobante rechazado no emite nota de crédito", badVoid.json?.status === "voided" && !badVoid.json?.einvoices?.some?.((d) => d.docType === "NC"), badVoid.json?.einvoices);
    const rejected = (await call("GET", "/einvoice/documents?status=rejected", { token: admin })).json;
    check("filtro por estado", rejected?.items?.length >= 1 && rejected.items.every((d) => d.status === "rejected"), rejected?.items?.length);
    const finalRetry = await retry(badDoc.id);
    check("un comprobante con respuesta definitiva no se reintenta → 409", finalRetry.code === "EINVOICE_FINAL", finalRetry.json);

    section("Contingencia y credenciales");
    await call("PUT", "/einvoice/settings", { token: admin, body: { ...settingsBody, contingency: true } });
    const cont = await sell(null);
    const contDoc = cont.json?.einvoices?.[0];
    check("en contingencia la clave lleva situación 3 (sin internet)", contDoc?.clave?.[41] === "3", contDoc?.clave);
    const waiting = await retry(contDoc.id);
    check("y espera en la cola sin enviarse", waiting.json?.status === "pending" && !mock.received.has(contDoc.clave), waiting.json?.status);
    await call("PUT", "/einvoice/settings", { token: admin, body: settingsBody });
    const contDone = await settle(contDoc.id);
    check("al salir de contingencia se envía y se acepta", contDone?.status === "accepted" && mock.received.has(contDoc.clave), contDone);

    await call("PUT", "/einvoice/credentials", { token: admin, body: { username: ATV_USER, password: "clave-equivocada" } });
    const wrong = await sell(null);
    const wrongDoc = (await retry(wrong.json.einvoices[0].id)).json;
    check("clave del ATV inválida: queda pendiente con el error y no se reintenta enseguida", wrongDoc?.status === "pending" && /usuario del ATV/.test(wrongDoc?.lastError ?? "") && mock.badLogins >= 1, wrongDoc);
    await call("PUT", "/einvoice/credentials", { token: admin, body: { username: ATV_USER, password: ATV_PASSWORD } });
    const fixed = await settle(wrongDoc.id);
    check("con la clave corregida se envía", fixed?.status === "accepted", fixed);

    const list = (await call("GET", `/einvoice/documents?saleId=${fe.json.id}`, { token: admin })).json;
    check("comprobantes de una venta: factura y nota", list?.items?.length === 2 && list.items.some((d) => d.docType === "NC") && list.items.some((d) => d.docType === "FE"), list?.items);
    const st1 = (await call("GET", "/einvoice/settings", { token: admin })).json;
    check("resumen por estado", st1?.counts?.accepted >= 6 && st1?.counts?.rejected >= 1, st1?.counts);

    section("Sin comprobantes activos");
    await call("PUT", "/einvoice/settings", { token: admin, body: { ...settingsBody, isEnabled: false } });
    const plain = await sell(null);
    check("la venta no reserva comprobante", plain.status === 201 && plain.json?.einvoices?.length === 0, plain.json?.einvoices);
    const tPlain = (await call("GET", `/pos/sales/${plain.json.id}/ticket`, { token: admin })).json;
    check("y el ticket vuelve a ser provisional", tPlain?.legends?.[0] === "DOCUMENTO PROVISIONAL" && tPlain?.einvoice === null, tPlain?.legends);
  } finally {
    if (session?.id) {
      const closed = await closeSessionAsExpected(admin, session.id);
      check("cierra el turno", closed.status === 200, closed.json);
    }
    await call("PUT", "/einvoice/settings", { token: admin, body: { ...settingsBody, isEnabled: false } }).catch(() => undefined);
    await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyVE.id } });
    server.close();
  }
}
