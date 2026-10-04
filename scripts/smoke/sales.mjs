/**
 * @project FabriHub
 * @file scripts/smoke/sales.mjs
 * @description Suite de humo de la fase 6: clientes, vendedores, listas de precios de venta, órdenes de
 * venta con motor fiscal y retención del cliente, control de crédito con segregación, reservas FEFO,
 * pedidos pendientes, notas de entrega (FEFO automático y manual), anulación y trazabilidad lote → cliente.
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-6);
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;
  const [warehouses, customers, treatments] = await Promise.all([lk("warehouses"), lk("customers"), lk("fiscal-treatments")]);
  const id = (list, code) => list.find((x) => x.code === code)?.id;
  const product = async (code) => (await call("GET", `/lookups/products?search=${code}`, { token: admin })).json.find((p) => p.code === code);
  const [para, vitc, almidon] = await Promise.all([product("PT-PARA500-20"), product("PT-VITC500-30"), product("MP-ALMIDON")]);
  const PT = id(warehouses, "PT");
  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const role = (slug) => roles.find((r) => r.slug === slug).id;

  section("Clientes y vendedores");
  const badRif = await call("POST", "/sales/customers", { token: admin, body: { code: `C${T}`, legalName: "Cliente prueba", rif: "J1" } });
  check("RIF inválido → 400", badRif.status === 400, badRif.json);
  const dupRif = await call("POST", "/sales/customers", { token: admin, body: { code: `C${T}`, legalName: "Cliente prueba", rif: "J-41000001-0" } });
  check("RIF repetido → 409 RIF_TAKEN", dupRif.code === "RIF_TAKEN" && /DROCENTRO/.test(dupRif.json?.error?.message), dupRif.json);
  const cust = await call("POST", "/sales/customers", {
    token: admin,
    body: { code: `cli-${T}`, legalName: `Cliente de prueba ${T}`, rif: `J-5${T.padStart(7, "0")}-1`, creditLimit: 100, fiscalTreatmentId: id(treatments, "G16") }
  });
  check("alta de cliente con límite de crédito", cust.status === 201 && cust.json.creditLimit === 100 && cust.json.code === `CLI-${T}`, cust.json);
  const contact = await call("POST", `/sales/customers/${cust.json.id}/contacts`, { token: admin, body: { name: "Rosa Compras", isPrimary: true } });
  check("contacto del cliente", contact.json?.contacts?.length === 1, contact.json);
  const seller = await call("POST", "/settings/catalogs/sellers", { token: admin, body: { code: `V${T}`, name: "Vendedor de prueba", phone: null, email: null, commissionPct: 3 } });
  check("vendedor con el motor de catálogos (SAL_SELLERS)", seller.status === 201, seller.json);
  const lists = (await call("GET", "/sales/price-lists", { token: admin })).json;
  const pvp = lists.find((l) => l.code === "PVP-26");
  check("listas de venta separadas de las de compra (scope sales)", pvp && lists.every((l) => l.scope === "sales") && pvp.parties >= 2, lists);

  section("Orden de venta: precios e impuestos");
  const FARMAVIDA = id(customers, "FARMAVIDA");
  const DROCENTRO = id(customers, "DROCENTRO");
  const base = { orderDate: today(), warehouseId: PT };
  const notSold = await call("POST", "/sales/orders", { token: admin, body: { ...base, customerId: FARMAVIDA, lines: [{ productId: almidon.id, quantity: 1 }] } });
  check("no se vende lo que no está marcado como «se vende»", notSold.code === "NOT_SOLD", notSold.json);
  const o1 = await call("POST", "/sales/orders", {
    token: admin,
    body: { ...base, customerId: FARMAVIDA, customerReference: `OC-FV-${T}`, lines: [{ productId: para.id, quantity: 100 }, { productId: vitc.id, quantity: 10 }] }
  });
  const o1Para = o1.json?.lines?.find((l) => l.productCode === "PT-PARA500-20");
  const o1Vitc = o1.json?.lines?.find((l) => l.productCode === "PT-VITC500-30");
  check("precio de lista PVP-26 (3,60) y promoción vigente (4,70)", o1Para?.unitPrice === 3.6 && o1Para.priceSource === "list" && o1Vitc?.unitPrice === 4.7 && o1Vitc.priceSource === "promo", o1.json?.lines);
  check("medicamento exento, vitamina gravada 16 %; sin retención (cliente no es agente)", o1Para.taxRate === 0 && o1Vitc.taxRate === 16 && near(o1.json.taxAmount, 7.52) && o1.json.withholdingAmount === 0, o1.json);
  const o2 = await call("POST", "/sales/orders", { token: admin, body: { ...base, customerId: DROCENTRO, lines: [{ productId: vitc.id, quantity: 50 }] } });
  check("droguería contribuyente especial: retiene el 75 % del IVA", near(o2.json?.withholdingAmount, o2.json?.taxAmount * 0.75) && near(o2.json.receivable, o2.json.total - o2.json.withholdingAmount), o2.json);
  check("precio de droguería (lista DROG-26)", o2.json.lines[0].unitPrice === 4.8, o2.json.lines);

  section("Confirmar: crédito y reserva FEFO");
  const c1 = await call("POST", `/sales/orders/${o1.json.id}/confirm`, { token: admin });
  const paraRes = c1.json?.lines?.find((l) => l.productCode === "PT-PARA500-20");
  check("confirmar → confirmada con todo reservado", c1.json?.status === "confirmed" && c1.json.lines.every((l) => near(l.quantityReserved, l.quantity, 1e-6)), c1.json);
  check("la reserva toma primero el lote que vence antes (L2508)", paraRes?.reservations?.[0]?.lotCode === "L2508", paraRes?.reservations);
  const editConfirmed = await call("PUT", `/sales/orders/${o1.json.id}`, { token: admin, body: { ...base, customerId: FARMAVIDA, lines: [{ productId: para.id, quantity: 1 }] } });
  check("una orden confirmada ya no se edita", editConfirmed.code === "INVALID_STATUS", editConfirmed.json);

  const seller1 = await createUserWith(admin, `vendedor.${T}@fabrihub.local`, "Vendedor", [{ moduleCode: "SAL_ORDERS", roleIds: [role("seller")], permissions: [] }]);
  const big = await call("POST", "/sales/orders", { token: seller1.token, body: { ...base, customerId: FARMAVIDA, lines: [{ productId: para.id, quantity: 600 }] } });
  const bigConfirm = await call("POST", `/sales/orders/${big.json.id}/confirm`, { token: seller1.token });
  check("excede el límite de crédito → retenida (pendiente de aprobación) y sin reservas", bigConfirm.json?.status === "pending_approval" && bigConfirm.json.creditHold && bigConfirm.json.lines[0].quantityReserved === 0, bigConfirm.json);
  const sellerList = await call("GET", "/sales/orders", { token: seller1.token });
  check("el vendedor sin view_all solo ve sus órdenes", sellerList.json?.items?.length === 1 && sellerList.json.items[0].id === big.json.id, sellerList.json?.items?.map((o) => o.number));
  const sellerPeek = await call("GET", `/sales/orders/${o1.json.id}`, { token: seller1.token });
  check("…y la orden de otro le responde 404", sellerPeek.status === 404, sellerPeek.json);
  const sellerApprove = await call("POST", `/sales/orders/${big.json.id}/approve`, { token: seller1.token });
  check("el vendedor no aprueba crédito (sin permiso approve) → 403", sellerApprove.status === 403, sellerApprove.json);
  const approved = await call("POST", `/sales/orders/${big.json.id}/approve`, { token: admin });
  check("otra persona aprueba el crédito → confirmada y reservada", approved.json?.status === "confirmed" && approved.json.approvedBy && near(approved.json.lines[0].quantityReserved, 600, 1e-6), approved.json);
  const bigLots = approved.json.lines[0].reservations.map((r) => r.lotCode);
  check("FEFO entre órdenes: lo que quedaba de L2508 (200) y el resto de L2601", bigLots[0] === "L2508" && near(approved.json.lines[0].reservations[0].quantity, 200, 1e-6) && bigLots[1] === "L2601", approved.json.lines[0].reservations);

  // Pedido pendiente (BackOrder): más vitamina de la que hay
  const vitcStock = (await call("GET", `/inventory/stock?productId=${vitc.id}&warehouseId=${PT}`, { token: admin })).json.items.reduce((a, r) => a + r.quantity - (r.reserved ?? 0), 0);
  const HOSPSUR = id(customers, "HOSPSUR");
  const bo = await call("POST", "/sales/orders", { token: admin, body: { ...base, customerId: HOSPSUR, lines: [{ productId: vitc.id, quantity: vitcStock + 50 }] } });
  const boConfirm = await call("POST", `/sales/orders/${bo.json.id}/confirm`, { token: admin });
  check("sin existencia suficiente → confirmada con pedido pendiente (BackOrder)", boConfirm.json?.status === "confirmed" && boConfirm.json.backorder?.[0]?.missing > 0, boConfirm.json?.backorder);
  const params = (await call("GET", "/settings/parameters", { token: admin })).json;
  const backorderParam = params.find((p) => p.key === "allow_backorder");
  await call("PATCH", `/settings/parameters/${backorderParam.id}`, { token: admin, body: { value: false } });
  const strict = await call("POST", "/sales/orders", { token: admin, body: { ...base, customerId: HOSPSUR, lines: [{ productId: vitc.id, quantity: 10 }] } });
  const strictConfirm = await call("POST", `/sales/orders/${strict.json.id}/confirm`, { token: admin });
  check("sin backorder permitido, la confirmación se rechaza y la orden sigue en borrador", strictConfirm.code === "INSUFFICIENT_STOCK", strictConfirm.json);
  await call("PATCH", `/settings/parameters/${backorderParam.id}`, { token: admin, body: { value: true } });
  await call("POST", `/sales/orders/${bo.json.id}/cancel`, { token: admin, body: { reason: "Prueba de pedido pendiente" } });

  section("Notas de entrega (FEFO)");
  const pending = await call("GET", "/sales/deliveries/pending-orders", { token: admin });
  check("la orden confirmada aparece por despachar", pending.json?.some((o) => o.id === o1.json.id), pending.json);
  const forDelivery = await call("GET", `/sales/deliveries/order/${o1.json.id}`, { token: admin });
  const paraLine = forDelivery.json.lines.find((l) => l.productCode === "PT-PARA500-20");
  const vitcLine = forDelivery.json.lines.find((l) => l.productCode === "PT-VITC500-30");
  const lotL2601 = forDelivery.json.lots.find((l) => l.soLineId === paraLine.id && l.lotCode === "L2601");
  const fefo = await call("POST", `/sales/orders/${o1.json.id}/deliveries`, {
    token: admin,
    body: { deliveryDate: today(), lines: [{ soLineId: paraLine.id, quantity: 60, lots: [{ lotId: lotL2601.lotId, quantity: 60 }] }] }
  });
  check("elegir a mano un lote que vence después → 409 FEFO_VIOLATION", fefo.code === "FEFO_VIOLATION" && /L2508/.test(fefo.json?.error?.message), fefo.json);
  const over = await call("POST", `/sales/orders/${o1.json.id}/deliveries`, { token: admin, body: { deliveryDate: today(), lines: [{ soLineId: paraLine.id, quantity: 101 }] } });
  check("no se despacha más de lo pedido", over.code === "OVER_DELIVERY", over.json);

  const wh = await createUserWith(admin, `despacho.${T}@fabrihub.local`, "Despachador", [{ moduleCode: "SAL_DELIVERY_NOTES", roleIds: [role("warehouse")], permissions: [] }]);
  const whDeliver = await call("POST", `/sales/orders/${o1.json.id}/deliveries`, { token: wh.token, body: { deliveryDate: today(), lines: [{ soLineId: paraLine.id, quantity: 1 }] } });
  check("un despachador sin el almacén PT asignado no despacha → 403 OUT_OF_SCOPE", whDeliver.code === "OUT_OF_SCOPE", whDeliver.json);

  const n1 = await call("POST", `/sales/orders/${o1.json.id}/deliveries`, {
    token: admin,
    body: { deliveryDate: today(), carrier: "Transporte propio", lines: [{ soLineId: paraLine.id, quantity: 60 }, { soLineId: vitcLine.id, quantity: 10 }] }
  });
  check("despacho parcial automático (FEFO) desde L2508", n1.status === 201 && n1.json.lines.find((l) => l.productCode === "PT-PARA500-20")?.lotCode === "L2508", n1.json);
  check("la nota guarda venta neta y costo de lo despachado (margen)", near(n1.json.netAmount, 60 * 3.6 + 10 * 4.7) && n1.json.costAmount > 0 && n1.json.movementNumber, n1.json);
  const afterN1 = await call("GET", `/sales/orders/${o1.json.id}`, { token: admin });
  const afterPara = afterN1.json.lines.find((l) => l.productCode === "PT-PARA500-20");
  check("orden despachada parcialmente; la reserva baja a lo pendiente (40)", afterN1.json.status === "partially_delivered" && near(afterPara.quantityReserved, 40, 1e-6) && afterPara.quantityDelivered === 60, afterN1.json);
  const n2 = await call("POST", `/sales/orders/${o1.json.id}/deliveries`, { token: admin, body: { deliveryDate: today(), lines: [{ soLineId: paraLine.id, quantity: 40 }] } });
  const afterN2 = await call("GET", `/sales/orders/${o1.json.id}`, { token: admin });
  check("despacho final → orden despachada y sin reservas", n2.status === 201 && afterN2.json.status === "delivered" && afterN2.json.lines.every((l) => l.quantityReserved === 0), afterN2.json);

  const trace = await call("GET", "/sales/deliveries/trace?lotCode=l2508", { token: admin });
  check("trazabilidad por código de lote: L2508 llegó a FarmaVida (100 cajas en 2 notas)", trace.json?.[0]?.deliveries?.filter((d) => d.customerCode === "FARMAVIDA").reduce((a, d) => a + d.quantity, 0) === 100, trace.json);

  const reverse = await call("POST", `/inventory/movements/${n2.json.movementId}/reverse`, { token: admin });
  check("el movimiento de un despacho no se reversa desde Inventario", reverse.code === "REVERSE_FROM_SOURCE", reverse.json);
  const cancelN2 = await call("POST", `/sales/deliveries/${n2.json.id}/cancel`, { token: admin, body: { reason: "Cliente rechazó la mercancía en puerta" } });
  const afterCancel = await call("GET", `/sales/orders/${o1.json.id}`, { token: admin });
  check("anular la nota reversa la salida, vuelve a parcial y re-reserva lo pendiente", cancelN2.json?.status === "cancelled" && afterCancel.json.status === "partially_delivered" && near(afterCancel.json.lines.find((l) => l.productCode === "PT-PARA500-20").quantityReserved, 40, 1e-6), afterCancel.json);
  const cancelO1 = await call("POST", `/sales/orders/${o1.json.id}/cancel`, { token: admin, body: { reason: "Ya no lo quiere" } });
  check("una orden con despachos no se anula (se cierra)", cancelO1.code === "HAS_DELIVERIES", cancelO1.json);
  const closeO1 = await call("POST", `/sales/orders/${o1.json.id}/close`, { token: admin, body: { reason: "El cliente no recibirá el resto" } });
  check("cerrar con pendientes suelta las reservas", closeO1.json?.status === "closed" && closeO1.json.lines.every((l) => l.quantityReserved === 0), closeO1.json);

  // Limpieza: la orden grande no debe dejar reservado el inventario para las demás suites
  await call("POST", `/sales/orders/${big.json.id}/cancel`, { token: admin, body: { reason: "Fin de la prueba" } });
  const afterBig = await call("GET", `/sales/orders/${big.json.id}`, { token: admin });
  check("anular una orden confirmada libera su reserva", afterBig.json.status === "cancelled" && afterBig.json.lines[0].quantityReserved === 0, afterBig.json);
}
