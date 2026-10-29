/**
 * @project FabriHub
 * @file scripts/smoke/files.mjs
 * @description Fase 11: código de barras, imagen del producto (validación, re-codificación, URLs firmadas,
 *              reemplazo y borrado) y aislamiento por empresa. Usa solo la sesión del administrador.
 */

import { crc32, deflateSync } from "node:zlib";
import { API_ORIGIN, adminSession, call, check, section } from "./_client.mjs";

const T = Date.now().toString().slice(-6);

/** PNG RGBA de w × h generado a mano (sin dependencias) */
function makePng(w, h, [r, g, b] = [200, 40, 40]) {
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
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + w * 4);
  for (let x = 0; x < w; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const fetchImage = async (url) => {
  const res = await fetch(`${API_ORIGIN}${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), buf };
};
const isWebp = (buf) => buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";

export async function run() {
  const admin = await adminSession();
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;
  const [units, types] = await Promise.all([lk("units"), lk("product-types")]);
  const base = { productTypeId: types.find((t) => t.code === "PT").id, stockUnitId: units.find((u) => u.code === "UND").id, isSold: true };

  section("Código de barras");
  const barcode = `759${T}0001`;
  const p1 = await call("POST", "/inventory/products", { token: admin, body: { ...base, code: `IMG-${T}`, name: "Producto con imagen", barcode } });
  check("alta con código de barras", p1.status === 201 && p1.json.barcode === barcode && p1.json.image === null, p1.json);
  const p2 = await call("POST", "/inventory/products", { token: admin, body: { ...base, code: `IMG2-${T}`, name: "Otro producto", barcode } });
  check("código de barras repetido en la empresa → 409", p2.code === "DUPLICATED", p2.json);
  const bad = await call("POST", "/inventory/products", { token: admin, body: { ...base, code: `IMG3-${T}`, name: "Malo", barcode: "<script>" } });
  check("código de barras con caracteres inválidos → 400", bad.status === 400, bad.json);
  const byBarcode = await call("GET", `/inventory/products?search=${barcode}`, { token: admin });
  check("el listado encuentra por código de barras", byBarcode.json?.items?.[0]?.id === p1.json.id, byBarcode.json);
  const lookup = await call("GET", `/lookups/products?search=${barcode}`, { token: admin });
  check("el buscador encuentra por código de barras", lookup.json?.[0]?.id === p1.json.id && "imageThumb" in lookup.json[0], lookup.json);
  const cleared = await call("PATCH", `/inventory/products/${p1.json.id}`, { token: admin, body: { barcode: "" } });
  check("vaciar el código de barras lo deja nulo", cleared.json?.barcode === null, cleared.json);
  await call("PATCH", `/inventory/products/${p1.json.id}`, { token: admin, body: { barcode } });

  section("Imagen: validación");
  const id = p1.json.id;
  const put = (body, type = "image/png") => call("PUT", `/inventory/products/${id}/image`, { token: admin, body, headers: { "content-type": type } });
  const svg = await put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml");
  check("SVG → 415", svg.status === 415 && svg.code === "UNSUPPORTED_IMAGE", svg.json);
  const fake = await put(Buffer.from("esto no es una imagen, aunque diga image/png"));
  check("texto con Content-Type image/png → 415 (se mira el contenido)", fake.status === 415, fake.json);
  const html = await put(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<html><script>x</script></html>")]), "image/jpeg");
  check("firma JPEG con contenido basura → 400", html.code === "CORRUPT_IMAGE", html.json);
  const tiny = await put(makePng(8, 8));
  check("imagen demasiado pequeña → 400", tiny.code === "IMAGE_TOO_SMALL", tiny.json);
  const big = await put(Buffer.alloc(6 * 1024 * 1024, 1));
  check("más de 5 MB → 413", big.status === 413 && big.code === "FILE_TOO_LARGE", big.json);
  const empty = await put(Buffer.alloc(0));
  check("cuerpo vacío → 400", empty.status === 400, empty.json);

  section("Imagen: subida y entrega");
  const up = await put(makePng(300, 200), "image/jpeg");
  const img = up.json?.image;
  check("sube un PNG (aunque el Content-Type diga JPEG)", up.status === 200 && Boolean(img?.thumb && img?.medium && img?.full), up.json);
  const thumb = await fetchImage(img.thumb);
  check("la miniatura se sirve sin token, como WebP", thumb.status === 200 && thumb.type === "image/webp" && isWebp(thumb.buf), thumb);
  check("con caché privada", /private, max-age=\d+, immutable/.test(thumb.cache ?? ""), thumb.cache);
  const full = await fetchImage(img.full);
  check("la variante completa es WebP re-codificado", full.status === 200 && isWebp(full.buf) && full.buf.length > 0);
  const tampered = await fetchImage(img.thumb.replace(/sig=[0-9a-f]{4}/, "sig=0000"));
  check("firma alterada → 403", tampered.status === 403);
  const otherVariant = await fetchImage(img.thumb.replace("/96.webp", "/orig.webp"));
  check("la firma de una variante no sirve para otra → 403", otherVariant.status === 403);
  const longer = await fetchImage(img.thumb.replace(/exp=(\d+)/, (_m, e) => `exp=${Number(e) + 86400}`));
  check("alargar el vencimiento invalida la firma → 403", longer.status === 403);
  const traversal = await fetchImage(`/api/v1/files/..%2F..%2Fetc/passwd/96.webp?exp=9999999999&sig=${"0".repeat(32)}`);
  check("rutas fuera del almacenamiento → rechazadas", traversal.status === 403 || traversal.status === 404, traversal.status);
  const detail = await call("GET", `/inventory/products/${id}`, { token: admin });
  check("el detalle trae la imagen", Boolean(detail.json?.image?.medium));
  const listed = await call("GET", `/inventory/products?search=IMG-${T}`, { token: admin });
  check("el listado trae la miniatura", Boolean(listed.json?.items?.[0]?.image?.thumb), listed.json?.items?.[0]);

  section("Imagen: reemplazo y borrado");
  const up2 = await put(makePng(120, 240, [20, 120, 200]));
  check("reemplaza la imagen (otro archivo)", up2.status === 200 && up2.json.image.thumb !== img.thumb, up2.json);
  check("el archivo anterior ya no existe", (await fetchImage(img.thumb)).status === 404);
  const del = await call("DELETE", `/inventory/products/${id}/image`, { token: admin });
  check("quita la imagen", del.status === 200 && del.json.image === null, del.json);
  check("y borra su contenido", (await fetchImage(up2.json.image.thumb)).status === 404);

  const p3 = await call("POST", "/inventory/products", { token: admin, body: { ...base, code: `IMG4-${T}`, name: "Se borrará" } });
  const up3 = await call("PUT", `/inventory/products/${p3.json.id}/image`, { token: admin, body: makePng(64, 64), headers: { "content-type": "image/png" } });
  const gone = await call("DELETE", `/inventory/products/${p3.json.id}`, { token: admin });
  check("borrar un producto se lleva su imagen", gone.status === 204 && (await fetchImage(up3.json.image.thumb)).status === 404);

  section("Imagen: aislamiento por empresa");
  await put(makePng(100, 100));
  const principal = (await call("GET", "/auth/me", { token: admin })).json.company;
  const currencies = await lk("currencies");
  const other = await call("POST", "/admin/companies", {
    token: admin,
    body: { code: `IMG-${T}`, legalName: "Empresa de imágenes, C.A.", rif: "J-87654321-0", baseCurrencyId: currencies[0].id }
  });
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: other.json.id } });
  const foreign = await call("PUT", `/inventory/products/${id}/image`, { token: admin, body: makePng(50, 50), headers: { "content-type": "image/png" } });
  check("otra empresa no sube imagen a un producto ajeno → 404", foreign.status === 404, foreign.json);
  const foreignDel = await call("DELETE", `/inventory/products/${id}/image`, { token: admin });
  check("ni la quita → 404", foreignDel.status === 404, foreignDel.json);
  const sameBarcode = await call("POST", "/inventory/products", { token: admin, body: { ...base, code: `IMG-${T}`, name: "Mismo código en otra empresa", barcode } });
  check("el mismo código de barras vale en otra empresa", sameBarcode.status === 201, sameBarcode.json);
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: principal.id } });
  const still = await call("GET", `/inventory/products/${id}`, { token: admin });
  check("la imagen de la empresa original sigue intacta", Boolean(still.json?.image?.thumb));
  await call("PATCH", `/admin/companies/${other.json.id}`, { token: admin, body: { isActive: false } });
}
