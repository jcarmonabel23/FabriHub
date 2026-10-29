/**
 * @project FabriHub
 * @file scripts/smoke/branding.mjs
 * @description Fase 12: identidad de la empresa (logo, ícono y color) en la sesión, Excel, PDF y correos.
 *              Usa solo la sesión del administrador.
 */

import { crc32, deflateSync } from "node:zlib";
import { API, API_ORIGIN, MAIL, adminSession, call, check, section, sleep } from "./_client.mjs";

const T = Date.now().toString().slice(-6);

/** PNG RGBA de w × h generado a mano (sin dependencias) */
function makePng(w, h, [r, g, b] = [22, 124, 148]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4);
  for (let x = 0; x < w; x++) row.set([r, g, b, 255], 1 + x * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const isPng = (buf) => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

async function fetchUrl(url) {
  const res = await fetch(`${API_ORIGIN}${url}`);
  return { status: res.status, type: res.headers.get("content-type"), buf: Buffer.from(await res.arrayBuffer()) };
}

/** GET binario con sesión (Excel / PDF) */
async function download(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    disposition: res.headers.get("content-disposition"),
    buf: Buffer.from(await res.arrayBuffer())
  };
}

async function lastMail(to) {
  for (let i = 0; i < 15; i++) {
    const data = await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`)).json();
    const id = data.messages?.[0]?.ID;
    if (id) return (await fetch(`${MAIL}/message/${id}`)).json();
    await sleep(300);
  }
  return null;
}

export async function run() {
  const admin = await adminSession();
  const put = (kind, body) => call("PUT", `/settings/company/${kind}`, { token: admin, body, headers: { "content-type": "image/png" } });

  section("Identidad: logo, ícono y color");
  const before = await call("GET", "/settings/company", { token: admin });
  check("la empresa empieza sin logo ni ícono", before.json?.logo === null && before.json?.icon === null, before.json);

  const logo = await put("logo", makePng(600, 200));
  check("sube el logo", logo.status === 200 && Boolean(logo.json?.logo?.header && logo.json?.logo?.doc), logo.json);
  const doc = await fetchUrl(logo.json.logo.doc);
  check("el logo para documentos es PNG (Excel y PDF no admiten WebP)", doc.status === 200 && doc.type === "image/png" && isPng(doc.buf), doc.type);
  const [dw, dh] = pngSize(doc.buf);
  check("conserva la proporción (máx. 800 × 240)", dw === 600 && dh === 200, [dw, dh]);
  const header = await fetchUrl(logo.json.logo.header);
  check("el logo de la cabecera es WebP", header.status === 200 && header.type === "image/webp");
  const svg = await call("PUT", "/settings/company/logo", { token: admin, body: Buffer.from("<svg/>"), headers: { "content-type": "image/svg+xml" } });
  check("logo SVG → 415", svg.status === 415, svg.json);

  const icon = await put("icon", makePng(300, 200));
  const fav = await fetchUrl(icon.json?.icon?.favicon);
  check("sube el ícono: favicon PNG cuadrado de 32 px", icon.status === 200 && isPng(fav.buf) && pngSize(fav.buf).join() === "32,32", pngSize(fav.buf));

  const { logo: _l, icon: _i, brandColor: _b, baseCurrencyCode: _c, updatedAt: _u, ...data } = before.json;
  const color = await call("PUT", "/settings/company", { token: admin, body: { ...data, brandColor: "#AA3300" } });
  check("guarda el color de marca (normalizado)", color.json?.brandColor === "#aa3300", color.json);
  const badColor = await call("PUT", "/settings/company", { token: admin, body: { ...data, brandColor: "red" } });
  check("color inválido → 400", badColor.status === 400, badColor.json);
  const kept = await call("PUT", "/settings/company", { token: admin, body: data });
  check("guardar sin enviar el color lo conserva", kept.json?.brandColor === "#aa3300", kept.json?.brandColor);

  const me = await call("GET", "/auth/me", { token: admin });
  const c = me.json?.company;
  check("la sesión trae logo, ícono y color", Boolean(c?.logo?.header && c?.icon?.favicon) && c?.brandColor === "#aa3300", c);

  section("Documentos con la identidad");
  const reports = await call("GET", "/dashboard/reports", { token: admin });
  const code = reports.json?.[0]?.code;
  const xlsx = await download(`/dashboard/reports/${code}/xlsx`, admin);
  check(
    "el Excel lleva el logo incrustado",
    xlsx.status === 200 && xlsx.buf.subarray(0, 2).toString() === "PK" && xlsx.buf.includes("xl/media/image1.png"),
    { status: xlsx.status, code }
  );

  const so = (await call("GET", "/sales/orders?pageSize=1", { token: admin })).json?.items?.[0];
  const soPdf = await download(`/sales/orders/${so?.id}/pdf`, admin);
  const isPdf = (r) => r.status === 200 && r.type === "application/pdf" && r.buf.subarray(0, 5).toString() === "%PDF-";
  check("PDF de la orden de venta", isPdf(soPdf) && /attachment; filename="OV_/.test(soPdf.disposition ?? ""), { status: soPdf.status, type: soPdf.type });
  check("con el logo de la empresa", soPdf.buf.includes("/Subtype /Image"));
  const dn = (await call("GET", "/sales/deliveries?pageSize=1", { token: admin })).json?.items?.[0];
  const dnPdf = await download(`/sales/deliveries/${dn?.id}/pdf`, admin);
  check("PDF de la nota de entrega", isPdf(dnPdf) && dnPdf.buf.includes("/Subtype /Image"), { status: dnPdf.status });
  const po = (await call("GET", "/purchases/orders?pageSize=1", { token: admin })).json?.items?.[0];
  const poPdf = await download(`/purchases/orders/${po?.id}/pdf`, admin);
  check("PDF de la orden de compra", isPdf(poPdf) && poPdf.buf.includes("/Subtype /Image"), { status: poPdf.status });
  const missing = await download(`/sales/orders/00000000-0000-4000-8000-000000000000/pdf`, admin);
  check("PDF de una orden inexistente → 404", missing.status === 404);

  section("Correo con la identidad");
  const email = `marca-${T}@fabrihub.local`;
  await call("POST", "/admin/users", { token: admin, body: { email, names: "Usuario de marca" } });
  const mail = await lastMail(email);
  check("el asunto lleva el nombre de la empresa", Boolean(mail?.Subject) && !mail.Subject.startsWith("FabriHub ·"), mail?.Subject);
  check("el logo va incrustado en el correo (CID)", mail?.HTML?.includes("cid:company-logo") && (mail?.Inline?.length ?? 0) + (mail?.Attachments?.length ?? 0) >= 1, {
    inline: mail?.Inline?.length,
    attachments: mail?.Attachments?.length
  });
  check("y su color", mail?.HTML?.includes("#aa3300"));

  section("Identidad por empresa");
  const currencies = (await call("GET", "/lookups/currencies", { token: admin })).json;
  const other = await call("POST", "/admin/companies", {
    token: admin,
    body: { code: `BRD-${T}`, legalName: "Empresa sin marca, C.A.", rif: "J-11223344-5", baseCurrencyId: currencies[0].id }
  });
  const sw = await call("POST", "/auth/switch-company", { token: admin, body: { companyId: other.json.id } });
  check("otra empresa no hereda el logo ni el color", sw.json?.company?.logo === null && sw.json?.company?.brandColor === null, sw.json?.company);
  const foreignPdf = await download(`/sales/orders/${so?.id}/pdf`, admin);
  check("ni ve el PDF de una orden ajena → 404", foreignPdf.status === 404, foreignPdf.status);
  const plainXlsx = await download(`/dashboard/reports/${code}/xlsx`, admin);
  check("su Excel sale sin logo", plainXlsx.status === 200 && !plainXlsx.buf.includes("xl/media/image1.png"));
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: c.id } });
  await call("PATCH", `/admin/companies/${other.json.id}`, { token: admin, body: { isActive: false } });

  section("Quitar la identidad");
  const rmLogo = await call("DELETE", "/settings/company/logo", { token: admin });
  check("quita el logo", rmLogo.status === 200 && rmLogo.json?.logo === null && rmLogo.json?.icon !== null, rmLogo.json);
  check("y borra su contenido", (await fetchUrl(logo.json.logo.doc)).status === 404);
  const rmIcon = await call("DELETE", "/settings/company/icon", { token: admin });
  check("quita el ícono", rmIcon.json?.icon === null);
  await call("PUT", "/settings/company", { token: admin, body: { ...data, brandColor: null } });
  const plain = await download(`/sales/orders/${so?.id}/pdf`, admin);
  check("sin logo el PDF sigue saliendo (con el nombre)", isPdf(plain) && !plain.buf.includes("/Subtype /Image"));
}
