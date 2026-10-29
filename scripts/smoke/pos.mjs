/**
 * @project FabriHub
 * @file scripts/smoke/pos.mjs
 * @description Fase 13: punto de venta (cajas, turnos, venta en una transacción, pagos combinados,
 *              IGTF, supervisor, anulación, arqueo y aislamiento por empresa).
 *              Usa la sesión del administrador (supervisor) y, como cajero, un usuario de una suite
 *              anterior (knownUsers): no abre sesiones nuevas.
 */

import { API, ADMIN_NEW, adminSession, call, check, knownUsers, section } from "./_client.mjs";

const T = Date.now().toString().slice(-5);
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;
const r2 = (n) => Math.round(n * 100) / 100;

async function download(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get("content-type"), buf: Buffer.from(await res.arrayBuffer()) };
}

export async function run() {
  const admin = await adminSession();
  const me = (await call("GET", "/auth/me", { token: admin })).json;
  const warehouses = (await call("GET", "/lookups/warehouses", { token: admin })).json;
  const PT = warehouses.find((w) => w.code === "PT");
  const lists = (await call("GET", "/lookups/sales-price-lists", { token: admin })).json;
  const PVP = lists.find((l) => l.code === "PVP-26");
  const currencies = (await call("GET", "/lookups/currencies", { token: admin })).json;
  const VES = currencies.find((c) => c.code === "VES");
  const USD = currencies.find((c) => c.code === "USD");

  section("Cajas");
  const code = `CJ${T}`;
  const t1 = await call("POST", "/pos/terminals", { token: admin, body: { code, name: "Caja principal", warehouseId: PT.id, priceListId: PVP.id } });
  check("crea la caja con su almacén y su lista", t1.status === 201 && t1.json?.warehouseCode === "PT" && t1.json?.priceListCode === "PVP-26", t1.json);
  check("prefijo por defecto = código- y correlativo desde 1", t1.json?.ticketPrefix === `${code}-` && t1.json?.nextTicket === 1, t1.json);
  const dupCode = await call("POST", "/pos/terminals", { token: admin, body: { code, name: "Otra", warehouseId: PT.id } });
  check("código repetido → 409", dupCode.code === "DUPLICATED_CODE", dupCode.json);
  const dupPrefix = await call("POST", "/pos/terminals", { token: admin, body: { code: `CK${T}`, name: "Otra", warehouseId: PT.id, ticketPrefix: `${code}-` } });
  check("prefijo repetido → 409", dupPrefix.code === "DUPLICATED_PREFIX", dupPrefix.json);
  const badList = await call("POST", "/pos/terminals", {
    token: admin,
    body: { code: `CL${T}`, name: "Otra", warehouseId: PT.id, priceListId: "00000000-0000-4000-8000-000000000000" }
  });
  check("lista inexistente → 400", badList.code === "INVALID_PRICE_LIST", badList.json);
  const t2 = await call("POST", "/pos/terminals", { token: admin, body: { code: `CK${T}`, name: "Caja 2", warehouseId: PT.id, priceListId: PVP.id, ticketPrefix: `K${T}-` } });
  check("segunda caja", t2.status === 201, t2.json);

  section("Turno del supervisor");
  const mine0 = await call("GET", "/pos/me", { token: admin });
  check("sin turno abierto; ve las cajas activas", mine0.json?.session === null && mine0.json?.terminals?.some((t) => t.code === code), mine0.json);
  check(
    "trae las monedas cobrables con la tasa de hoy y los parámetros de la caja",
    mine0.json?.currencies?.some((c) => c.isBase && c.rate === 1) && mine0.json?.currencies?.some((c) => c.code === "USD" && c.rate > 1) && mine0.json?.settings?.maxDiscountPct === 5,
    { currencies: mine0.json?.currencies, settings: mine0.json?.settings }
  );
  const s1 = await call("POST", "/pos/sessions", { token: admin, body: { terminalId: t1.json.id, openingFloat: [{ currencyId: VES.id, amount: 100 }] } });
  check("abre el turno con fondo de 100 Bs", s1.status === 201 && s1.json?.status === "open" && s1.json?.counts?.[0]?.opening === 100, s1.json);
  const s1again = await call("POST", "/pos/sessions", { token: admin, body: { terminalId: t2.json.id } });
  check("un cajero no abre dos turnos → 409", s1again.code === "CASHIER_BUSY", s1again.json);
  const busyEdit = await call("PUT", `/pos/terminals/${t1.json.id}`, { token: admin, body: { code, name: "Caja principal", warehouseId: PT.id, isActive: false } });
  check("no se desactiva una caja con turno abierto → 409", busyEdit.code === "SESSION_OPEN", busyEdit.json);

  section("Catálogo y clientes");
  const cat = await call("GET", `/pos/catalog?terminalId=${t1.json.id}&search=PT-`, { token: admin });
  const para = cat.json?.find?.((p) => p.code === "PT-PARA500-20");
  const vitc = cat.json?.find?.((p) => p.code === "PT-VITC500-30");
  check("productos vendibles con precio de la lista y disponible", para?.price > 0 && para?.available > 0 && vitc?.price > 0, para);
  check("con su alícuota de IVA", vitc?.taxRate === 16 && para?.taxRate === 0, { vitc: vitc?.taxRate, para: para?.taxRate });
  check("la promoción vigente manda", vitc?.isPromo === true, vitc);
  const byName = await call("GET", `/pos/catalog?terminalId=${t1.json.id}&search=paracetamol`, { token: admin });
  check("búsqueda por nombre (pg_trgm)", byName.json?.some?.((p) => p.code === "PT-PARA500-20"), byName.json?.map?.((p) => p.code));

  const rif = `V-${String(10000000 + Number(T)).slice(0, 8)}`;
  const quick = await call("POST", "/pos/customers", { token: admin, body: { rif: rif.replace("-", "").toLowerCase(), name: "Pedro Pérez" } });
  check("alta rápida con cédula (sin dígito verificador)", quick.status === 201 && quick.json?.rif === rif, quick.json);
  const quickDup = await call("POST", "/pos/customers", { token: admin, body: { rif, name: "Otro" } });
  check("cédula repetida → 409 con el cliente existente", quickDup.code === "CUSTOMER_EXISTS", quickDup.json);
  const quickBad = await call("POST", "/pos/customers", { token: admin, body: { rif: "X-123", name: "Malo" } });
  check("identificación inválida → 400", quickBad.code === "INVALID_RIF", quickBad.json);
  const found = await call("GET", `/pos/customers?search=${rif.slice(2)}`, { token: admin });
  check("búsqueda por cédula", found.json?.[0]?.id === quick.json?.id, found.json);

  section("Cotizar y vender");
  const lines = [
    { productId: para.id, quantity: 2 },
    { productId: vitc.id, quantity: 1 }
  ];
  const expectedTotal = r2(r2(2 * para.price) + r2(vitc.price) + r2((r2(vitc.price) * 16) / 100));
  const quote = await call("POST", "/pos/sales/quote", { token: admin, body: { sessionId: s1.json.id, lines } });
  check("cotiza con precio e IVA del servidor", near(quote.json?.total, expectedTotal) && near(quote.json?.pending, expectedTotal), {
    total: quote.json?.total,
    expectedTotal
  });
  check("cliente por defecto: Consumidor final", quote.json?.customer?.isFinalConsumer === true, quote.json?.customer);
  check("IVA desglosado por alícuota", quote.json?.taxes?.some((t) => t.rate === 16), quote.json?.taxes);

  const short = await call("POST", "/pos/sales", { token: admin, body: { sessionId: s1.json.id, lines, payments: [{ method: "cash", currencyId: VES.id, amount: 1 }] } });
  check("pago insuficiente → 400", short.code === "INSUFFICIENT_PAYMENT", short.json);
  const noRef = await call("POST", "/pos/sales", { token: admin, body: { sessionId: s1.json.id, lines, payments: [{ method: "card", currencyId: VES.id, amount: expectedTotal }] } });
  check("punto de venta sin referencia → 400", noRef.code === "REFERENCE_REQUIRED", noRef.json);
  const overCard = await call("POST", "/pos/sales", {
    token: admin,
    body: { sessionId: s1.json.id, lines, payments: [{ method: "card", currencyId: VES.id, amount: expectedTotal + 5, reference: "1234" }] }
  });
  check("los pagos electrónicos no dan vuelto → 400", overCard.code === "OVERPAID_NON_CASH", overCard.json);

  const usdRate = quote.json ? (await call("POST", "/pos/sales/quote", { token: admin, body: { sessionId: s1.json.id, lines, payments: [{ method: "cash", currencyId: USD.id, amount: 1 }] } })).json?.payments?.[0]?.exchangeRate : null;
  const sale = await call("POST", "/pos/sales", {
    token: admin,
    body: {
      sessionId: s1.json.id,
      customerId: quick.json.id,
      lines,
      payments: [
        { method: "cash", currencyId: USD.id, amount: 0.2 },
        { method: "cash", currencyId: VES.id, amount: 10 }
      ]
    }
  });
  const paid = r2(r2(0.2 * usdRate) + 10);
  check("vende con pago combinado (USD + Bs en efectivo)", sale.status === 201 && sale.json?.status === "completed", sale.json);
  check("comprobante con el correlativo de la caja", sale.json?.ticketNumber === `${code}-00000001`, sale.json?.ticketNumber);
  check("cada pago guarda su moneda y la tasa del día", sale.json?.payments?.[0]?.currencyCode === "USD" && sale.json.payments[0].exchangeRate === usdRate, sale.json?.payments);
  check("vuelto = pagado − total", near(sale.json?.changeAmount, r2(paid - expectedTotal)), { change: sale.json?.changeAmount, paid, expectedTotal });
  check("salida de inventario con costo", Boolean(sale.json?.movementNumber) && sale.json?.costAmount > 0, sale.json?.movementNumber);
  const after = (await call("GET", `/pos/catalog?terminalId=${t1.json.id}&search=PT-PARA500-20`, { token: admin })).json?.[0];
  check("descuenta la existencia", near(after?.available, para.available - 2, 1e-6), { before: para.available, after: after?.available });
  const tooMuch = await call("POST", "/pos/sales", {
    token: admin,
    body: { sessionId: s1.json.id, lines: [{ productId: para.id, quantity: 1e6 }], payments: [{ method: "cash", currencyId: VES.id, amount: 1e8 }] }
  });
  check("sin existencia suficiente → 409 y nada cambia", tooMuch.code === "INSUFFICIENT_STOCK", tooMuch.json);
  const pdf = await download(`/pos/sales/${sale.json?.id}/pdf`, admin);
  check("comprobante en PDF", pdf.status === 200 && pdf.type === "application/pdf" && pdf.buf.subarray(0, 5).toString() === "%PDF-", pdf.status);

  section("IGTF");
  const params = (await call("GET", "/settings/parameters", { token: admin })).json;
  const igtfOn = params.find((p) => p.moduleCode === "POS" && p.key === "igtf_enabled");
  await call("PATCH", `/settings/parameters/${igtfOn.id}`, { token: admin, body: { value: true } });
  const igtfSale = await call("POST", "/pos/sales", {
    token: admin,
    body: { sessionId: s1.json.id, lines: [{ productId: vitc.id, quantity: 1 }], payments: [{ method: "cash", currencyId: USD.id, amount: 1 }] }
  });
  const vTotal = r2(r2(vitc.price) + r2((r2(vitc.price) * 16) / 100));
  check("IGTF 3 % sobre lo pagado en divisas", near(igtfSale.json?.igtfAmount, r2(vTotal * 0.03)) && near(igtfSale.json?.grandTotal, r2(vTotal + r2(vTotal * 0.03))), {
    igtf: igtfSale.json?.igtfAmount,
    grand: igtfSale.json?.grandTotal
  });
  const igtfBs = await call("POST", "/pos/sales/quote", { token: admin, body: { sessionId: s1.json.id, lines: [{ productId: vitc.id, quantity: 1 }], payments: [{ method: "cash", currencyId: VES.id, amount: 100 }] } });
  check("pagando en Bs no hay IGTF", igtfBs.json?.igtf?.amount === 0, igtfBs.json?.igtf);
  await call("PATCH", `/settings/parameters/${igtfOn.id}`, { token: admin, body: { value: false } });

  section("Cajero y supervisor");
  let cashier = null;
  for (const u of [...knownUsers].reverse()) {
    const m = await call("GET", "/auth/me", { token: u.token });
    if (m.status === 200 && m.json?.company?.id === me.company.id && !m.json?.user?.isPlatformAdmin) {
      cashier = u;
      break;
    }
  }
  check("hay un usuario para el papel de cajero", Boolean(cashier));
  await call("PUT", `/admin/users/${cashier.id}/modules`, {
    token: admin,
    body: {
      assignments: [
        { moduleCode: "POS_SALES", roleIds: [], permissions: ["access", "view", "add_new"] },
        { moduleCode: "POS_SESSIONS", roleIds: [], permissions: ["access", "view", "add_new", "close"] }
      ]
    }
  });
  const cs = await call("POST", "/pos/sessions", { token: cashier.token, body: { terminalId: t1.json.id } });
  check("la caja ocupada no se abre dos veces → 409", cs.code === "TERMINAL_BUSY", cs.json);
  const s2 = await call("POST", "/pos/sessions", { token: cashier.token, body: { terminalId: t2.json.id, openingFloat: [{ currencyId: VES.id, amount: 50 }] } });
  check("el cajero abre su turno", s2.status === 201, s2.json);
  const intruder = await call("POST", "/pos/sales/quote", { token: cashier.token, body: { sessionId: s1.json.id, lines } });
  check("no vende en el turno de otro → 403", intruder.code === "NOT_YOUR_SESSION", intruder.json);

  const discLines = [{ productId: para.id, quantity: 1, discountPct: 10 }];
  const dq = (await call("POST", "/pos/sales/quote", { token: cashier.token, body: { sessionId: s2.json.id, lines: discLines } })).json;
  check("un descuento sobre el límite pide supervisor", dq?.needsSupervisor === true && dq?.maxDiscountPct === 5, dq);
  const pay = [{ method: "mobile", currencyId: VES.id, amount: dq.grandTotal, reference: "000123" }];
  const noSup = await call("POST", "/pos/sales", { token: cashier.token, body: { sessionId: s2.json.id, lines: discLines, payments: pay } });
  check("sin supervisor → 403", noSup.code === "SUPERVISOR_REQUIRED", noSup.json);

  const weak = await call("PUT", "/pos/supervisor-pin", { token: admin, body: { password: ADMIN_NEW, pin: "1234" } });
  check("clave de supervisor débil → 400", weak.code === "WEAK_PIN", weak.json);
  const badPwd = await call("PUT", "/pos/supervisor-pin", { token: admin, body: { password: "otra", pin: "4826" } });
  check("fijar la clave exige la contraseña", badPwd.code === "INVALID_PASSWORD", badPwd.json);
  const pin = await call("PUT", "/pos/supervisor-pin", { token: admin, body: { password: ADMIN_NEW, pin: "4826" } });
  check("el supervisor fija su clave", pin.status === 204, pin.json);
  const cannotPin = await call("PUT", "/pos/supervisor-pin", { token: cashier.token, body: { password: "x", pin: "4826" } });
  check("un cajero no tiene clave de supervisor → 403", cannotPin.status === 403, cannotPin.json);
  const sups = (await call("GET", "/pos/supervisors", { token: cashier.token })).json;
  check("el cajero ve a los supervisores", sups?.some?.((s) => s.id === me.user.id && s.hasPin), sups);

  const wrong = await call("POST", "/pos/sales", { token: cashier.token, body: { sessionId: s2.json.id, lines: discLines, payments: pay, supervisor: { userId: me.user.id, pin: "9999" } } });
  check("clave equivocada → 403", wrong.code === "INVALID_SUPERVISOR", wrong.json);
  const authorized = await call("POST", "/pos/sales", { token: cashier.token, body: { sessionId: s2.json.id, lines: discLines, payments: pay, supervisor: { userId: me.user.id, pin: "4826" } } });
  check("con la clave del supervisor, vende", authorized.status === 201 && authorized.json?.discountAuthorizedBy === me.user.names, authorized.json);
  check("con el correlativo de SU caja", authorized.json?.ticketNumber === `K${T}-00000001`, authorized.json?.ticketNumber);

  const cList = (await call("GET", "/pos/sales", { token: cashier.token })).json;
  check("sin view_all solo ve sus ventas", cList?.items?.length === 1 && cList.items[0].id === authorized.json?.id, cList?.items?.map?.((s) => s.ticketNumber));
  const peek = await call("GET", `/pos/sales/${sale.json.id}`, { token: cashier.token });
  check("ni abre las de otros → 404", peek.status === 404);

  section("Anular");
  const stockBefore = (await call("GET", `/pos/catalog?terminalId=${t2.json.id}&search=PT-PARA500-20`, { token: admin })).json?.[0]?.available;
  const voidNoSup = await call("POST", `/pos/sales/${authorized.json.id}/void`, { token: cashier.token, body: { reason: "Cliente desistió" } });
  check("anular sin supervisor → 403", voidNoSup.code === "SUPERVISOR_REQUIRED", voidNoSup.json);
  const voided = await call("POST", `/pos/sales/${authorized.json.id}/void`, {
    token: cashier.token,
    body: { reason: "Cliente desistió", supervisor: { userId: me.user.id, pin: "4826" } }
  });
  check("anula con la clave del supervisor", voided.json?.status === "voided" && voided.json?.voidAuthorizedBy === me.user.names, voided.json);
  const stockAfter = (await call("GET", `/pos/catalog?terminalId=${t2.json.id}&search=PT-PARA500-20`, { token: admin })).json?.[0]?.available;
  check("la mercancía vuelve al almacén", near(stockAfter, stockBefore + 1, 1e-6), { stockBefore, stockAfter });
  const again = await call("POST", `/pos/sales/${authorized.json.id}/void`, { token: admin, body: { reason: "Otra vez" } });
  check("no se anula dos veces → 409", again.code === "ALREADY_VOIDED", again.json);
  const voidedPdf = await download(`/pos/sales/${authorized.json.id}/pdf`, admin);
  check("el comprobante anulado sigue saliendo en PDF", voidedPdf.status === 200);

  section("Cierre de turno (arqueo)");
  const noCount = await call("POST", `/pos/sessions/${s1.json.id}/close`, { token: admin, body: {} });
  check("el efectivo debe contarse → 400", noCount.code === "CASH_NOT_COUNTED", noCount.json);
  const s1d = (await call("GET", `/pos/sessions/${s1.json.id}`, { token: admin })).json;
  const cashVes = s1d.counts.find((c) => c.method === "cash" && c.currencyCode === "VES");
  const cashUsd = s1d.counts.find((c) => c.method === "cash" && c.currencyCode === "USD");
  const changeVes = r2((sale.json?.changeAmount ?? 0) + (igtfSale.json?.changeAmount ?? 0));
  check("esperado en Bs = fondo + cobrado − vuelto", near(cashVes?.expected, r2(100 + 10 - changeVes)), { cashVes, changeVes });
  check("esperado en USD = lo cobrado en USD", near(cashUsd?.expected, 1.2), cashUsd);
  const closed = await call("POST", `/pos/sessions/${s1.json.id}/close`, {
    token: admin,
    body: { counts: s1d.counts.filter((c) => c.method === "cash").map((c) => ({ method: "cash", currencyId: c.currencyId, amount: c.expected })) }
  });
  check("cierra cuadrado: diferencia 0", closed.json?.status === "closed" && closed.json?.differenceTotal === 0 && closed.json?.salesCount === 2, closed.json);
  const late = await call("POST", "/pos/sales/quote", { token: admin, body: { sessionId: s1.json.id, lines } });
  check("no se vende en un turno cerrado → 409", late.code === "SESSION_CLOSED", late.json);
  const lateVoid = await call("POST", `/pos/sales/${sale.json.id}/void`, { token: admin, body: { reason: "Tarde" } });
  check("ni se anula una venta de un turno cerrado → 409", lateVoid.code === "SESSION_CLOSED", lateVoid.json);

  const s2d = (await call("GET", `/pos/sessions/${s2.json.id}`, { token: cashier.token })).json;
  const short2 = s2d.counts.find((c) => c.method === "cash" && c.currencyCode === "VES");
  const shortBody = { counts: [{ method: "cash", currencyId: VES.id, amount: short2.expected - 1 }] };
  const noNotes = await call("POST", `/pos/sessions/${s2.json.id}/close`, { token: cashier.token, body: shortBody });
  check("con faltante y sin observación → 400", noNotes.code === "NOTES_REQUIRED", noNotes.json);
  const closed2 = await call("POST", `/pos/sessions/${s2.json.id}/close`, { token: cashier.token, body: { ...shortBody, notes: "Faltó 1 Bs" } });
  check("cierra con la diferencia registrada", closed2.json?.status === "closed" && closed2.json?.differenceTotal === -1 && closed2.json?.salesCount === 0, closed2.json);
  const otherList = (await call("GET", "/pos/sessions", { token: cashier.token })).json;
  check("el cajero solo ve sus turnos", otherList?.items?.every?.((s) => s.cashierId === cashier.id), otherList?.items?.length);

  section("Caja con historia");
  const del = await call("DELETE", `/pos/terminals/${t1.json.id}`, { token: admin });
  check("una caja con turnos no se elimina → 409", del.code === "IN_USE", del.json);
  const prefixChange = await call("PUT", `/pos/terminals/${t1.json.id}`, { token: admin, body: { code, name: "Caja principal", warehouseId: PT.id, ticketPrefix: "NUEVO-" } });
  check("ni cambia el prefijo tras emitir comprobantes → 409", prefixChange.code === "PREFIX_LOCKED", prefixChange.json);
  const off = await call("PUT", `/pos/terminals/${t1.json.id}`, { token: admin, body: { code, name: "Caja principal", warehouseId: PT.id, isActive: false } });
  check("se desactiva", off.json?.isActive === false && off.json?.nextTicket === 3, off.json);

  section("Bloqueo de la clave de supervisor");
  for (let i = 0; i < 5; i++) {
    await call("POST", `/pos/sales/${authorized.json.id}/void`, { token: cashier.token, body: { reason: "Prueba", supervisor: { userId: me.user.id, pin: "0000" } } });
  }
  const lockedVoid = await call("POST", `/pos/sales/${authorized.json.id}/void`, { token: cashier.token, body: { reason: "Prueba", supervisor: { userId: me.user.id, pin: "4826" } } });
  check("5 fallos bloquean la clave (aun la correcta) → 423", lockedVoid.status === 423 && lockedVoid.code === "SUPERVISOR_LOCKED", lockedVoid.json);

  section("Aislamiento por empresa");
  const other = await call("POST", "/admin/companies", {
    token: admin,
    body: { code: `POS-${T}`, legalName: "Empresa sin cajas, C.A.", rif: "J-22334455-6", baseCurrencyId: VES.id }
  });
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: other.json.id } });
  const foreignT = await call("GET", "/pos/terminals", { token: admin });
  check("otra empresa no ve las cajas", foreignT.status === 200 && foreignT.json.length === 0, foreignT.json);
  const foreignS = await call("GET", `/pos/sales/${sale.json.id}`, { token: admin });
  check("ni las ventas → 404", foreignS.status === 404);
  const foreignOpen = await call("POST", "/pos/sessions", { token: admin, body: { terminalId: t2.json.id } });
  check("ni abre turnos en cajas ajenas → 404", foreignOpen.status === 404, foreignOpen.json);
  const params2 = (await call("GET", "/settings/parameters", { token: admin })).json;
  check("la empresa nueva trae los parámetros del POS", params2.some((p) => p.moduleCode === "POS" && p.key === "max_discount_pct"));
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: me.company.id } });
  await call("PATCH", `/admin/companies/${other.json.id}`, { token: admin, body: { isActive: false } });
}
