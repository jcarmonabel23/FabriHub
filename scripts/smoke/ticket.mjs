/**
 * @project FabriHub
 * @file scripts/smoke/ticket.mjs
 * @description Fase 17: ticket térmico del POS. Configuración de impresión por caja, datos del ticket
 * con las leyendas de cada país (VE: no es factura fiscal; CR: provisional), impresión original y COPIA.
 *
 * Usa las ventas de la suite del POS (Venezuela) y hace una venta en la empresa de Costa Rica.
 * No abre sesiones nuevas.
 */

import { adminSession, call, check, closeSessionAsExpected, section } from "./_client.mjs";

const T = Date.now().toString(36).toUpperCase().slice(-6);

export async function run() {
  const admin = await adminSession();
  const companyVE = (await call("GET", "/auth/me", { token: admin })).json.company;

  section("Configuración de impresión de la caja");
  const sales = (await call("GET", "/pos/sales?pageSize=100", { token: admin })).json.items;
  const sale = sales.find((s) => s.status === "completed");
  const detail = (await call("GET", `/pos/sales/${sale.id}`, { token: admin })).json;
  const terminal = (await call("GET", `/pos/terminals/${detail.terminalId}`, { token: admin })).json;
  check("la caja nace con papel de 80 mm, 1 ejemplar y sin impresión automática", terminal.ticketWidthMm === 80 && terminal.ticketCopies === 1 && terminal.autoPrint === false, terminal);
  const body = {
    code: terminal.code,
    name: terminal.name,
    warehouseId: terminal.warehouseId,
    priceListId: terminal.priceListId,
    defaultCustomerId: terminal.defaultCustomerId,
    ticketPrefix: terminal.ticketPrefix,
    ticketPadding: terminal.ticketPadding,
    notes: terminal.notes,
    isActive: terminal.isActive
  };
  const upd = await call("PUT", `/pos/terminals/${terminal.id}`, {
    token: admin,
    body: { ...body, ticketWidthMm: 58, ticketCopies: 2, autoPrint: true, ticketFooter: "Cambios dentro de 7 días con el ticket" }
  });
  check("guarda papel de 58 mm, 2 ejemplares, impresión automática y pie", upd.json?.ticketWidthMm === 58 && upd.json?.ticketCopies === 2 && upd.json?.autoPrint && upd.json?.ticketFooter?.startsWith("Cambios"), upd.json);
  const badWidth = await call("PUT", `/pos/terminals/${terminal.id}`, { token: admin, body: { ...body, ticketWidthMm: 70 } });
  check("ancho no soportado (70 mm) → 400", badWidth.status === 400, badWidth.json);

  section("Ticket en Venezuela");
  const t = (await call("GET", `/pos/sales/${sale.id}/ticket`, { token: admin })).json;
  check("toma la configuración de la caja", t?.widthMm === 58 && t?.copies === 2 && t?.autoPrint === true && t?.footer?.startsWith("Cambios"), t);
  check("emisor con su RIF", t?.issuer?.taxIdLabel === "RIF" && /^[VEJPG]-\d{8}-\d$/.test(t?.issuer?.taxId ?? ""), t?.issuer);
  check("leyenda: no es factura fiscal", t?.legends?.[0] === "ESTE DOCUMENTO NO ES UNA FACTURA FISCAL", t?.legends);
  check("totales iguales a los de la venta", t?.grandTotal === detail.grandTotal && t?.lines?.length === detail.lines.length, { ticket: t?.grandTotal, sale: detail.grandTotal });
  const taxed = detail.lines.find((l) => l.taxRate === 16);
  check("líneas con la marca de alícuota (G = 16 %, E = exento)", !taxed || t.lines[detail.lines.indexOf(taxed)].taxMark === "G", t?.lines?.map((l) => l.taxMark));
  check("IVA desglosado por alícuota con su base", t?.taxes?.every((x) => typeof x.base === "number" && x.label), t?.taxes);
  check("aún no se ha impreso", t?.printCount === 0, t?.printCount);

  const p1 = await call("POST", `/pos/sales/${sale.id}/print`, { token: admin });
  check("primera impresión: ORIGINAL", p1.json?.print?.printNo === 1 && p1.json?.print?.isCopy === false, p1.json?.print);
  const p2 = await call("POST", `/pos/sales/${sale.id}/print`, { token: admin });
  check("reimpresión: COPIA", p2.json?.print?.printNo === 2 && p2.json?.print?.isCopy === true, p2.json?.print);
  const again = (await call("GET", `/pos/sales/${sale.id}/ticket`, { token: admin })).json;
  check("la vista previa sabe que ya se imprimió (2 veces)", again?.printCount === 2, again?.printCount);

  const consumer = sales.find((s) => s.customerName === "Consumidor final");
  if (consumer) {
    const tc = (await call("GET", `/pos/sales/${consumer.id}/ticket`, { token: admin })).json;
    check("consumidor final: sin datos de cliente", tc?.customer === null, tc?.customer);
  }
  const named = sales.find((s) => s.customerName !== "Consumidor final");
  if (named) {
    const tn = (await call("GET", `/pos/sales/${named.id}/ticket`, { token: admin })).json;
    check("cliente identificado: nombre y tipo de identificación", tn?.customer?.name === named.customerName && Boolean(tn?.customer?.idLabel), tn?.customer);
  }
  const voided = sales.find((s) => s.status === "voided");
  if (voided) {
    const tv = (await call("GET", `/pos/sales/${voided.id}/ticket`, { token: admin })).json;
    check("venta anulada: el ticket lo dice con el motivo", tv?.voided && tv.voided.reason, tv?.voided);
  }
  const withIgtf = [];
  for (const s of sales.filter((x) => x.status === "completed").slice(0, 20)) {
    const tx = (await call("GET", `/pos/sales/${s.id}/ticket`, { token: admin })).json;
    if (tx?.igtf) withIgtf.push(tx);
  }
  check("venta con IGTF: base, alícuota y monto en el ticket", withIgtf.length > 0 && withIgtf[0].igtf.rate === 3 && withIgtf[0].igtf.amount > 0, withIgtf[0]?.igtf);
  await call("PUT", `/pos/terminals/${terminal.id}`, { token: admin, body });

  section("Ticket en Costa Rica");
  const cr = (await call("GET", "/admin/companies", { token: admin })).json.find((c) => c.countryCode === "CR");
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: cr.id } });
  let session = null;
  try {
    const lookup = async (k) => (await call("GET", `/lookups/${k}`, { token: admin })).json;
    const [types, units, treatments, currencies] = await Promise.all([lookup("product-types"), lookup("units"), lookup("fiscal-treatments"), lookup("currencies")]);
    const wh = await call("POST", "/inventory/warehouses", { token: admin, body: { code: `TK${T}`, name: "Tienda", kind: "storage" } });
    const product = await call("POST", "/inventory/products", {
      token: admin,
      body: {
        code: `SRV-${T}`,
        name: "Instalación de software",
        productTypeId: (types.find((x) => x.code === "PT") ?? types[0]).id,
        stockUnitId: units.find((u) => u.code === "UND").id,
        isStockable: false,
        isSold: true,
        salePrice: 10000,
        fiscalTreatmentId: treatments.find((x) => x.code === "G13").id
      }
    });
    check("servicio con IVA 13 % para vender en Costa Rica", product.status === 201, product.json);
    const term = await call("POST", "/pos/terminals", { token: admin, body: { code: `CR${T}`, name: "Caja tica", warehouseId: wh.json.id } });
    const s = await call("POST", "/pos/sessions", { token: admin, body: { terminalId: term.json.id } });
    session = s.json;
    const CRC = currencies.find((c) => c.code === "CRC");
    const sold = await call("POST", "/pos/sales", {
      token: admin,
      body: { sessionId: session.id, lines: [{ productId: product.json.id, quantity: 1 }], payments: [{ method: "cash", currencyId: CRC.id, amount: 20000 }] }
    });
    check("venta en colones con IVA 13 %", sold.status === 201 && sold.json?.grandTotal === 11300 && sold.json?.currencyCode === "CRC", sold.json);
    const tcr = (await call("GET", `/pos/sales/${sold.json?.id}/ticket`, { token: admin })).json;
    check("emisor con cédula jurídica", tcr?.issuer?.taxIdLabel === "Cédula" && tcr?.issuer?.taxId === "3101123456", tcr?.issuer);
    check("leyenda: documento provisional (no sustituye al comprobante electrónico)", tcr?.legends?.[0] === "DOCUMENTO PROVISIONAL" && /Hacienda/.test(tcr?.legends?.[1] ?? ""), tcr?.legends);
    check("IVA 13 % con su base y marca «13%»", tcr?.taxes?.[0]?.label === "IVA 13%" && tcr?.taxes?.[0]?.base === 10000 && tcr?.lines?.[0]?.taxMark === "13%", tcr?.taxes);
    check("sin IGTF y vuelto de 8 700 colones", tcr?.igtf === null && tcr?.change?.amount === 8700 && tcr?.change?.currencyCode === "CRC", tcr?.change);
    check("hora de Costa Rica", tcr?.timezone === "America/Costa_Rica", tcr?.timezone);
  } finally {
    if (session?.id) await closeSessionAsExpected(admin, session.id);
    await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyVE.id } });
  }
}
