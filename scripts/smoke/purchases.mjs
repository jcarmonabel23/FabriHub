/**
 * @project FabriHub
 * @file scripts/smoke/purchases.mjs
 * @description Suite de humo de la fase 4: proveedores, listas de precios, órdenes de compra con motor
 * fiscal, aprobación con segregación de funciones, recepciones con lotes en cuarentena, Calidad,
 * devoluciones y anulaciones.
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-6);
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;
  const [units, types, warehouses, currencies, treatments] = await Promise.all([
    lk("units"),
    lk("product-types"),
    lk("warehouses"),
    lk("currencies"),
    lk("fiscal-treatments")
  ]);
  const id = (list, code) => list.find((x) => x.code === code).id;

  section("Proveedores");
  const badRif = await call("POST", "/purchases/suppliers", { token: admin, body: { code: `P${T}`, legalName: "Prueba", rif: "J123" } });
  check("RIF inválido → 400", badRif.status === 400, badRif.json);
  const dupRif = await call("POST", "/purchases/suppliers", { token: admin, body: { code: `P${T}`, legalName: "Prueba", rif: "J-40000001-1" } });
  check("RIF ya registrado → 409 RIF_TAKEN (mensaje con el proveedor)", dupRif.code === "RIF_TAKEN" && /QUIMIVEN/.test(dupRif.json?.error?.message), dupRif.json);
  const sup = await call("POST", "/purchases/suppliers", {
    token: admin,
    body: {
      code: `prov-${T}`,
      legalName: `Proveedor de prueba ${T}`,
      rif: `J-4${T.padStart(7, "0")}-5`,
      phones: ["0212-5551111"],
      fiscalTreatmentId: id(treatments, "G16_RIVA75"),
      currencyId: id(currencies, "VES")
    }
  });
  check("alta de proveedor", sup.status === 201 && sup.json.code === `PROV-${T}`, sup.json);
  const withContact = await call("POST", `/purchases/suppliers/${sup.json.id}/contacts`, {
    token: admin,
    body: { name: "Carlos Ventas", email: "carlos@demo.local", isPrimary: true }
  });
  check("contacto agregado", withContact.json?.contacts?.length === 1, withContact.json);

  section("Productos y lista de precios");
  const mkProduct = (body) => call("POST", "/inventory/products", { token: admin, body: { isPurchased: true, ...body } });
  const mp = await mkProduct({ code: `mpc-${T}`, name: "MP compras", productTypeId: id(types, "MP"), stockUnitId: id(units, "KG"), isLotControlled: true, shelfLifeDays: 365 });
  const me = await mkProduct({
    code: `mec-${T}`,
    name: "Empaque compras",
    productTypeId: id(types, "ME"),
    stockUnitId: id(units, "UND"),
    purchaseUnitId: id(units, "MILLAR"),
    purchaseFactor: 1000
  });
  const sv = await mkProduct({ code: `svc-${T}`, name: "Servicio compras", productTypeId: id(types, "SV"), stockUnitId: id(units, "H") });
  const pl = await call("POST", "/purchases/price-lists", { token: admin, body: { code: `PL-${T}`, name: "Lista prueba", currencyId: id(currencies, "USD") } });
  await call("PUT", `/purchases/price-lists/${pl.json.id}/items/${mp.json.id}`, {
    token: admin,
    body: { price: 10, promoPrice: 8, promoFrom: today(), promoTo: today() }
  });
  await call("PATCH", `/purchases/suppliers/${sup.json.id}`, { token: admin, body: { priceListId: pl.json.id } });
  const sug = await call(
    "GET",
    `/purchases/orders/price-suggestion?supplierId=${sup.json.id}&productId=${mp.json.id}&currencyId=${id(currencies, "VES")}&date=${today()}`,
    { token: admin }
  );
  const usdRate = (await call("GET", `/settings/currencies/${id(currencies, "USD")}/rates?limit=1`, { token: admin })).json[0].rate;
  const P = Math.round(8 * usdRate * 10000) / 10000;
  check(`precio sugerido: promoción vigente de la lista, convertida de USD a VES (8 × ${usdRate} = ${P})`, sug.json?.source === "promo" && near(sug.json.price, P), sug.json);

  section("Orden de compra y motor fiscal");
  await call("PUT", "/settings/company", {
    token: admin,
    body: { ...(await companyBody(admin)), isWithholdingAgent: true }
  });
  const params = (await call("GET", "/settings/parameters", { token: admin })).json;
  await call("PATCH", `/settings/parameters/${params.find((p) => p.key === "apply_withholdings").id}`, { token: admin, body: { value: true } });

  const orderBody = {
    supplierId: sup.json.id,
    orderDate: today(),
    warehouseId: id(warehouses, "MP"),
    lines: [
      { productId: mp.json.id, quantity: 100 },
      { productId: me.json.id, quantity: 2, unitPrice: 50000 },
      { productId: sv.json.id, quantity: 1, unitPrice: 1000 }
    ]
  };
  const preview = await call("POST", "/purchases/orders/preview", { token: admin, body: orderBody });
  const t = preview.json?.totals;
  const sub = Math.round((100 * P + 100000 + 1000) * 100) / 100;
  const iva = Math.round(sub * 0.16 * 100) / 100;
  const riva = Math.round(iva * 0.75 * 100) / 100;
  check(`subtotal ${sub} (100 × ${P} + 2 millares × 50.000 + 1.000)`, near(t?.subtotal, sub), t);
  check(`IVA 16% del proveedor (tratamiento 'both') sobre productos sin tratamiento: ${iva}`, near(t?.taxAmount, iva), t);
  check(`retención de IVA 75% sobre el impuesto del DOCUMENTO: ${riva}`, near(t?.withholdingAmount, riva), t?.withholdings);
  check("total = base + IVA y neto a pagar = total − retención", near(t?.total, sub + iva) && near(t?.payable, sub + iva - riva), t);

  const eur = await call("POST", "/purchases/orders/preview", { token: admin, body: { ...orderBody, currencyId: id(currencies, "EUR") } });
  check("orden en EUR sin tasa registrada → 400 NO_EXCHANGE_RATE", eur.code === "NO_EXCHANGE_RATE", eur.json);
  const notPurchased = await call("POST", "/purchases/orders/preview", {
    token: admin,
    body: { ...orderBody, lines: [{ productId: (await call("GET", "/lookups/products?search=PT-PARA500", { token: admin })).json[0].id, quantity: 1, unitPrice: 1 }] }
  });
  check("un producto que no se compra no entra en una OC", notPurchased.code === "NOT_PURCHASED", notPurchased.json);

  const po = await call("POST", "/purchases/orders", { token: admin, body: orderBody });
  check("orden creada en borrador con número OC-", po.status === 201 && po.json.status === "draft" && /^OC/.test(po.json.number), po.json);
  check("los montos guardados coinciden con la vista previa", near(po.json.payable, t?.payable), po.json);

  section("Aprobación (segregación de funciones)");
  const submitted = await call("POST", `/purchases/orders/${po.json.id}/submit`, { token: admin });
  check("enviar → pendiente de aprobación", submitted.json?.status === "pending_approval", submitted.json);
  const editAfter = await call("PUT", `/purchases/orders/${po.json.id}`, { token: admin, body: orderBody });
  check("una orden enviada ya no se edita", editAfter.code === "INVALID_STATUS", editAfter.json);
  const selfApprove = await call("POST", `/purchases/orders/${po.json.id}/approve`, { token: admin, body: {} });
  check("quien creó la orden no puede aprobarla → 403 SELF_APPROVAL", selfApprove.status === 403 && selfApprove.code === "SELF_APPROVAL", selfApprove.json);

  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const role = (slug) => roles.find((r) => r.slug === slug).id;
  const buyer = await createUserWith(admin, `comprador.${T}@fabrihub.local`, "Comprador", [{ moduleCode: "PUR_ORDERS", roleIds: [role("buyer")], permissions: [] }]);
  const buyerApprove = await call("POST", `/purchases/orders/${po.json.id}/approve`, { token: buyer.token, body: {} });
  check("el rol Comprador no tiene Aprobar → 403", buyerApprove.status === 403 && buyerApprove.code === "FORBIDDEN", buyerApprove.json);
  const boss = await createUserWith(admin, `jefe.compras.${T}@fabrihub.local`, "Jefe de compras", [
    { moduleCode: "PUR_ORDERS", roleIds: [role("buyer")], permissions: ["approve"] }
  ]);
  const approved = await call("POST", `/purchases/orders/${po.json.id}/approve`, { token: boss.token, body: {} });
  check("otro usuario con Aprobar la aprueba", approved.json?.status === "approved" && approved.json.approvedBy === "Jefe de compras", approved.json);

  section("Recepción → inventario en cuarentena");
  const lines = approved.json.lines;
  const lineOf = (pid) => lines.find((l) => l.productId === pid).id;
  const rec1 = await call("POST", `/purchases/orders/${po.json.id}/receptions`, {
    token: admin,
    body: {
      receptionDate: today(),
      deliveryNote: "NE-001",
      lines: [
        { poLineId: lineOf(mp.json.id), quantity: 60, lotCode: `L1-${T}`, supplierLot: "SUP-A" },
        { poLineId: lineOf(me.json.id), quantity: 1 }
      ]
    }
  });
  check("recepción parcial registrada con movimiento de inventario", rec1.status === 201 && /^MI-/.test(rec1.json.movementNumber ?? ""), rec1.json);
  const l1 = rec1.json.lines.find((l) => l.lotCode === `L1-${T}`);
  check("el lote recibido queda EN CUARENTENA", l1?.lotStatus === "quarantine", l1);
  check(`costo de entrada en moneda base por unidad de almacén: MP ${P}/KG, empaque 50/UND (50.000 ÷ 1.000)`,
    near(l1?.unitCost, P) && near(rec1.json.lines.find((l) => l.productCode === `MEC-${T}`)?.unitCost, 50), rec1.json.lines);
  const poAfter1 = await call("GET", `/purchases/orders/${po.json.id}`, { token: admin });
  check("la orden pasa a recepción parcial (BackOrder)", poAfter1.json.status === "partially_received", poAfter1.json.status);
  const over = await call("POST", `/purchases/orders/${po.json.id}/receptions`, {
    token: admin,
    body: { receptionDate: today(), lines: [{ poLineId: lineOf(mp.json.id), quantity: 46, lotCode: `LX-${T}` }] }
  });
  check("sobre-recepción por encima de la tolerancia (5%) → 400", over.code === "OVER_RECEIPT", over.json);
  const noLot = await call("POST", `/purchases/orders/${po.json.id}/receptions`, {
    token: admin,
    body: { receptionDate: today(), lines: [{ poLineId: lineOf(mp.json.id), quantity: 1 }] }
  });
  check("producto por lote sin lote → 400", noLot.code === "LOT_REQUIRED", noLot.json);

  const concepts = (await call("GET", "/inventory/movements/form-options", { token: admin })).json.concepts;
  const consume = (lotId, qty) =>
    call("POST", "/inventory/movements", {
      token: admin,
      body: { movementDate: today(), conceptId: concepts.find((c) => c.code === "CONSUMO").id, warehouseId: id(warehouses, "MP"), lines: [{ productId: mp.json.id, quantity: qty, lotId }] }
    });
  const blocked = await consume(l1.lotId, 5);
  check("un lote en cuarentena no se puede consumir", blocked.status === 400 && /no está liberado/.test(blocked.json?.error?.message), blocked.json);

  section("Calidad");
  const qcSelf = await call("POST", `/quality/lots/${l1.lotId}/approve`, { token: admin, body: { notes: "Conforme" } });
  check("quien recibió el lote no puede liberarlo → 403 SELF_APPROVAL", qcSelf.status === 403 && qcSelf.code === "SELF_APPROVAL", qcSelf.json);
  const qc = await createUserWith(admin, `calidad.${T}@fabrihub.local`, "Analista de calidad", [{ moduleCode: "QC_LOTS", roleIds: [role("quality")], permissions: [] }]);
  const queue = await call("GET", "/quality/lots?status=quarantine", { token: qc.token });
  const queued = queue.json?.items?.find((x) => x.id === l1.lotId);
  check("la cola de Calidad muestra el lote con proveedor y orden de compra", queued?.supplierName === `Proveedor de prueba ${T}` && queued?.orderNumber === po.json.number, queued);
  const noNotes = await call("POST", `/quality/lots/${l1.lotId}/approve`, { token: qc.token, body: { notes: "" } });
  check("aprobar exige fundamento", noNotes.status === 400);
  const ok = await call("POST", `/quality/lots/${l1.lotId}/approve`, { token: qc.token, body: { notes: "Análisis conforme a especificación", analysisRef: "CA-2026-114" } });
  check("Calidad aprueba y queda el registro de la decisión", ok.json?.qualityStatus === "approved" && ok.json.events?.[0]?.decidedBy === "Analista de calidad", ok.json);
  const again = await call("POST", `/quality/lots/${l1.lotId}/reject`, { token: qc.token, body: { notes: "Cambio de opinión" } });
  check("una decisión no se repite: el lote ya no está en cuarentena", again.code === "NOT_IN_QUARANTINE", again.json);
  const consumed = await consume(l1.lotId, 5);
  check("liberado, el lote ya se puede consumir", consumed.status === 201, consumed.json);

  section("Rechazo y devolución al proveedor");
  const rec2 = await call("POST", `/purchases/orders/${po.json.id}/receptions`, {
    token: admin,
    body: {
      receptionDate: today(),
      lines: [
        { poLineId: lineOf(mp.json.id), quantity: 40, lotCode: `L2-${T}` },
        { poLineId: lineOf(me.json.id), quantity: 1 },
        { poLineId: lineOf(sv.json.id), quantity: 1 }
      ]
    }
  });
  const poAfter2 = await call("GET", `/purchases/orders/${po.json.id}`, { token: admin });
  check("con todo recibido la orden pasa a Recibida (el servicio no genera inventario)", poAfter2.json.status === "received", poAfter2.json.status);
  const l2 = rec2.json.lines.find((l) => l.lotCode === `L2-${T}`);
  await call("POST", `/quality/lots/${l2.lotId}/reject`, { token: qc.token, body: { notes: "Humedad fuera de especificación", analysisRef: "CA-2026-115" } });
  const overReturn = await call("POST", `/purchases/receptions/${rec2.json.id}/returns`, {
    token: admin,
    body: { returnDate: today(), notes: "Lote rechazado por Calidad", lines: [{ receptionLineId: l2.id, quantity: 41 }] }
  });
  check("no se devuelve más de lo recibido", overReturn.code === "OVER_RETURN", overReturn.json);
  const ret = await call("POST", `/purchases/receptions/${rec2.json.id}/returns`, {
    token: admin,
    body: { returnDate: today(), notes: "Lote rechazado por Calidad", lines: [{ receptionLineId: l2.id, quantity: 40 }] }
  });
  check("devolución del lote RECHAZADO (DEV_PROV permite sacarlo)", ret.status === 201 && ret.json.kind === "return", ret.json);
  const poAfter3 = await call("GET", `/purchases/orders/${po.json.id}`, { token: admin });
  check("la devolución descuenta lo recibido: la orden vuelve a BackOrder", poAfter3.json.status === "partially_received" && poAfter3.json.lines.find((l) => l.productId === mp.json.id).quantityPending === 40, poAfter3.json.lines);
  const stock = await call("GET", `/inventory/stock?productId=${mp.json.id}`, { token: admin });
  check("existencia final del producto: 60 − 5 consumidos = 55 (el lote rechazado salió)", stock.json.items.reduce((a, r) => a + r.quantity, 0) === 55, stock.json.items);

  section("Anulaciones y cierre");
  const cancelRec = await call("POST", `/purchases/receptions/${rec1.json.id}/cancel`, { token: admin, body: { reason: "Prueba" } });
  check("no se anula una recepción cuyo lote ya se consumió", cancelRec.status === 400 && /insuficiente/.test(cancelRec.json?.error?.message), cancelRec.json);
  const reverseFromInv = await call("POST", `/inventory/movements/${rec1.json.movementId}/reverse`, { token: admin });
  check("el movimiento de una recepción no se reversa desde Inventario", reverseFromInv.code === "REVERSE_FROM_SOURCE", reverseFromInv.json);
  const cancelPo = await call("POST", `/purchases/orders/${po.json.id}/cancel`, { token: admin, body: { reason: "Ya no se necesita" } });
  check("una orden con mercancía recibida no se anula (se cierra)", cancelPo.code === "HAS_RECEPTIONS", cancelPo.json);
  const closed = await call("POST", `/purchases/orders/${po.json.id}/close`, { token: admin, body: { reason: "El proveedor no repondrá el lote" } });
  check("cierre con pendientes", closed.json?.status === "closed" && closed.json.closedBy, closed.json);

  const po2 = await call("POST", "/purchases/orders", { token: admin, body: { ...orderBody, lines: [orderBody.lines[2]] } });
  const cancelled = await call("POST", `/purchases/orders/${po2.json.id}/cancel`, { token: admin, body: { reason: "Duplicada" } });
  check("una orden sin recepciones se anula con motivo", cancelled.json?.status === "cancelled" && cancelled.json.cancelReason === "Duplicada", cancelled.json);

  // Deja la empresa como estaba para las demás suites
  await call("PATCH", `/settings/parameters/${params.find((p) => p.key === "apply_withholdings").id}`, { token: admin, body: { value: false } });
}

async function companyBody(token) {
  const c = (await call("GET", "/settings/company", { token })).json;
  const { baseCurrencyCode: _a, updatedAt: _b, ...rest } = c;
  return rest;
}
