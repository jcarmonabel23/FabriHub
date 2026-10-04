/**
 * @project FabriHub
 * @file scripts/smoke/inventory.mjs
 * @description Suite de humo de la fase 3: productos, lotes, movimientos, costo promedio, traslados,
 * reversos, inmutabilidad, alertas, kárdex y alcance por almacén.
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const near = (a, b) => Math.abs(a - b) < 1e-6;

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-6);
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;

  const [units, types, warehouses] = await Promise.all([lk("units"), lk("product-types"), lk("warehouses")]);
  const unit = (c) => units.find((u) => u.code === c).id;
  const type = (c) => types.find((t) => t.code === c).id;
  const wh = (c) => warehouses.find((w) => w.code === c).id;
  const form = (await call("GET", "/inventory/movements/form-options", { token: admin })).json;
  const concept = (c) => form.concepts.find((x) => x.code === c).id;

  section("Productos");
  const svc = await call("POST", "/inventory/products", {
    token: admin,
    body: { code: `sv-${T}`, name: "Servicio de prueba", productTypeId: type("SV"), stockUnitId: unit("H"), isStockable: true, isLotControlled: true }
  });
  check("un servicio nunca es inventariable ni lleva lote (se normaliza)", svc.status === 201 && !svc.json.isStockable && !svc.json.isLotControlled, svc.json);
  const mp = await call("POST", "/inventory/products", {
    token: admin,
    body: { code: `mp-${T}`, name: "Materia prima de prueba", productTypeId: type("MP"), stockUnitId: unit("KG"), isLotControlled: true, isPurchased: true, shelfLifeDays: 365 }
  });
  const me = await call("POST", "/inventory/products", {
    token: admin,
    body: { code: `me-${T}`, name: "Empaque de prueba", productTypeId: type("ME"), stockUnitId: unit("UND"), isPurchased: true }
  });
  check("alta de productos (código normalizado)", mp.status === 201 && mp.json.code === `MP-${T}` && me.status === 201, mp.json);
  const dupCode = await call("POST", "/inventory/products", {
    token: admin,
    body: { code: `MP-${T}`, name: "Otro", productTypeId: type("MP"), stockUnitId: unit("KG") }
  });
  check("código de producto repetido → 409", dupCode.status === 409, dupCode.json);

  const post = (body) => call("POST", "/inventory/movements", { token: admin, body: { movementDate: today(), ...body } });

  section("Entradas y costo promedio ponderado");
  const noLot = await post({ conceptId: concept("INV_INI"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 10, unitCost: 5 }] });
  check("producto por lote sin lote → 400", noLot.status === 400 && noLot.code === "LOT_REQUIRED", noLot.json);
  const noCost = await post({ conceptId: concept("INV_INI"), warehouseId: wh("ME"), lines: [{ productId: me.json.id, quantity: 10 }] });
  check("entrada sin costo → 400", noCost.code === "COST_REQUIRED", noCost.json);

  const in1 = await post({
    conceptId: concept("INV_INI"),
    warehouseId: wh("MP"),
    reference: "PRUEBA",
    lines: [{ productId: mp.json.id, quantity: 100, unitCost: 10, newLot: { lotCode: `A-${T}` } }]
  });
  check("entrada con lote nuevo contabilizada", in1.status === 201 && in1.json.status === "posted" && in1.json.number.startsWith("MI-"), in1.json);
  const lotA = in1.json.lines[0].lotId;
  check("el vencimiento se sugiere por la vida útil del producto (365 días)", Boolean(in1.json.lines[0].expiresOn), in1.json.lines[0]);
  const in2 = await post({
    conceptId: concept("AJ_POS"),
    warehouseId: wh("MP"),
    lines: [{ productId: mp.json.id, quantity: 100, unitCost: 20, newLot: { lotCode: `B-${T}`, expiresOn: "2030-01-31" } }]
  });
  const lotB = in2.json.lines[0].lotId;
  check("promedio ponderado: 100 a 10 + 100 a 20 → costo promedio 15", near(in2.json.lines[0].avgCostAfter, 15) && in2.json.lines[0].balanceAfter === 200, in2.json.lines[0]);
  const dupLot = await post({
    conceptId: concept("AJ_POS"),
    warehouseId: wh("MP"),
    lines: [{ productId: mp.json.id, quantity: 1, unitCost: 1, newLot: { lotCode: `A-${T}` } }]
  });
  check("lote ya existente → 409 (no se duplica)", dupLot.status === 409 && dupLot.code === "LOT_EXISTS", dupLot.json);

  section("Salidas");
  const out1 = await post({ conceptId: concept("CONSUMO"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 50, lotId: lotA }] });
  check("la salida sale al costo promedio (15) y no lo altera", near(out1.json.lines[0].unitCost, 15) && near(out1.json.lines[0].avgCostAfter, 15) && out1.json.lines[0].balanceAfter === 150, out1.json.lines?.[0]);
  const tooMuch = await post({ conceptId: concept("CONSUMO"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 51, lotId: lotA }] });
  check("existencia insuficiente en el lote → 400 con mensaje claro", tooMuch.status === 400 && /insuficiente/.test(tooMuch.json?.error?.message), tooMuch.json);

  const hold = await call("POST", `/inventory/lots/${lotA}/hold`, { token: admin, body: { reason: "Desviación en análisis" } });
  check("retener lote", hold.json?.qualityStatus === "on_hold", hold.json);
  const outHeld = await post({ conceptId: concept("CONSUMO"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 1, lotId: lotA }] });
  check("un lote retenido no sale", outHeld.status === 400 && /no está liberado/.test(outHeld.json?.error?.message), outHeld.json);
  const destroy = await post({ conceptId: concept("MERMA"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 1, lotId: lotA }] });
  check("Merma/destrucción sí puede sacar un lote retenido", destroy.status === 201, destroy.json);
  await call("POST", `/inventory/lots/${lotA}/release-hold`, { token: admin, body: { reason: "Investigación cerrada" } });

  const expired = await post({
    conceptId: concept("AJ_POS"),
    warehouseId: wh("MP"),
    lines: [{ productId: mp.json.id, quantity: 5, unitCost: 15, newLot: { lotCode: `V-${T}`, expiresOn: "2020-01-31" } }]
  });
  const outExpired = await post({ conceptId: concept("CONSUMO"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 1, lotId: expired.json.lines[0].lotId }] });
  check("un lote vencido no sale (salvo merma)", outExpired.status === 400 && /venció/.test(outExpired.json?.error?.message), outExpired.json);

  section("Traslados");
  const trf = await post({
    conceptId: concept("TRASLADO"),
    warehouseId: wh("MP"),
    targetWarehouseId: wh("PLANTA"),
    lines: [{ productId: mp.json.id, quantity: 40, lotId: lotB }]
  });
  const tl = trf.json?.lines?.[0];
  check("traslado: sale del origen y entra al destino al mismo costo promedio", trf.status === 201 && near(tl.unitCost, 15) && tl.targetBalanceAfter === 40 && near(tl.targetAvgCostAfter, 15), tl ?? trf.json);
  const noTarget = await post({ conceptId: concept("TRASLADO"), warehouseId: wh("MP"), lines: [{ productId: mp.json.id, quantity: 1, lotId: lotB }] });
  check("traslado sin destino → 400", noTarget.code === "TARGET_REQUIRED", noTarget.json);

  section("Reversos e inmutabilidad");
  const meIn = await post({ conceptId: concept("INV_INI"), warehouseId: wh("ME"), lines: [{ productId: me.json.id, quantity: 1000, unitCost: 0.1 }] });
  const meIn2 = await post({ conceptId: concept("AJ_POS"), warehouseId: wh("ME"), lines: [{ productId: me.json.id, quantity: 1000, unitCost: 0.3 }] });
  check("empaque: promedio 0,20 tras dos entradas", near(meIn2.json.lines[0].avgCostAfter, 0.2), meIn2.json.lines?.[0]);
  const rev = await call("POST", `/inventory/movements/${meIn2.json.id}/reverse`, { token: admin });
  check("el reverso saca al costo ORIGINAL (0,30) y el promedio vuelve a 0,10",
    rev.status === 201 && rev.json.reversalOfNumber === meIn2.json.number && near(rev.json.lines[0].unitCost, 0.3) && near(rev.json.lines[0].avgCostAfter, 0.1), rev.json);
  const orig = await call("GET", `/inventory/movements/${meIn2.json.id}`, { token: admin });
  check("el original queda marcado como reversado", orig.json.status === "reversed" && orig.json.reversedByNumber === rev.json.number, orig.json);
  const rev2 = await call("POST", `/inventory/movements/${meIn2.json.id}/reverse`, { token: admin });
  check("no se reversa dos veces", rev2.status === 400, rev2.json);
  const revRev = await call("POST", `/inventory/movements/${rev.json.id}/reverse`, { token: admin });
  check("un reverso no se reversa", revRev.status === 400, revRev.json);
  await post({ conceptId: concept("CONSUMO"), warehouseId: wh("ME"), lines: [{ productId: me.json.id, quantity: 900 }] });
  const revConsumed = await call("POST", `/inventory/movements/${meIn.json.id}/reverse`, { token: admin });
  check("no se reversa una entrada ya consumida (no se des-recibe lo gastado)", revConsumed.status === 400 && /insuficiente/.test(revConsumed.json?.error?.message), revConsumed.json);
  const noPatch = await call("PATCH", `/inventory/movements/${meIn.json.id}`, { token: admin, body: { notes: "x" } });
  check("no existe forma de editar un movimiento por la API", noPatch.status === 404);

  section("Reglas del maestro con historia");
  const changeLot = await call("PATCH", `/inventory/products/${mp.json.id}`, { token: admin, body: { isLotControlled: false } });
  check("con movimientos no se cambia el manejo por lote", changeLot.code === "HAS_HISTORY", changeLot.json);
  const delMoved = await call("DELETE", `/inventory/products/${mp.json.id}`, { token: admin });
  check("no se elimina un producto con historia (409)", delMoved.status === 409, delMoved.json);
  const delSvc = await call("DELETE", `/inventory/products/${svc.json.id}`, { token: admin });
  check("sí se elimina un producto sin movimientos", delSvc.status === 204);

  section("Existencias, kárdex y alertas");
  const stock = await call("GET", `/inventory/stock?productId=${mp.json.id}`, { token: admin });
  const total = stock.json.items.reduce((a, r) => a + r.quantity, 0);
  check("existencias por lote suman lo esperado (200 − 50 − 1 + 5 = 154)", total === 154, stock.json.items);
  const kx = await call("GET", `/inventory/stock/kardex?productId=${mp.json.id}&warehouseId=${wh("MP")}`, { token: admin });
  const last = kx.json.at(-1);
  check("kárdex del almacén MP: saldo corrido final 114 (154 − 40 trasladados)", last?.balance === 114 && last?.qtyOut === 40 && last?.counterpart === "a PLANTA", last);
  await call("PUT", `/inventory/warehouses/${wh("ME")}/policies/${me.json.id}`, { token: admin, body: { minQty: 500, maxQty: 2000 } });
  const alerts = await call("GET", "/inventory/stock/alerts", { token: admin });
  check("alerta de stock bajo el mínimo (100 < 500)", alerts.json.stock.some((a) => a.productId === me.json.id && a.kind === "below_min"), alerts.json.stock);
  check("alerta de lote vencido con existencia", alerts.json.lots.some((l) => l.lotCode === `V-${T}` && l.kind === "expired"), alerts.json.lots);

  section("Alcance por almacén y permisos");
  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const warehouseRole = roles.find((r) => r.slug === "warehouse");
  const alm = await createUserWith(admin, `almacen.mp.${T}@fabrihub.local`, "Almacenista MP", [
    { moduleCode: "INV_MOVEMENTS", roleIds: [warehouseRole.id], permissions: [] },
    { moduleCode: "INV_STOCK", roleIds: [warehouseRole.id], permissions: [] }
  ]);
  await call("PUT", `/admin/users/${alm.id}/warehouses`, { token: admin, body: { warehouseIds: [wh("MP")] } });
  const visible = await call("GET", "/inventory/stock?groupBy=product", { token: alm.token });
  check("el almacenista solo ve existencias de su almacén", visible.status === 200 && visible.json.items.length > 0 && visible.json.items.every((r) => r.warehouseCode === "MP"), visible.json.items?.map((r) => r.warehouseCode));
  const myForm = await call("GET", "/inventory/movements/form-options", { token: alm.token });
  check("el formulario solo le ofrece sus almacenes", myForm.json.warehouses.length === 1 && myForm.json.warehouses[0].code === "MP", myForm.json.warehouses);
  const otherWh = await call("POST", "/inventory/movements", {
    token: alm.token,
    body: { movementDate: today(), conceptId: concept("INV_INI"), warehouseId: wh("PT"), lines: [{ productId: me.json.id, quantity: 1, unitCost: 1 }] }
  });
  check("mover inventario en un almacén no asignado → 403 OUT_OF_SCOPE", otherWh.status === 403 && otherWh.code === "OUT_OF_SCOPE", otherWh.json);
  const trfOut = await call("POST", "/inventory/movements", {
    token: alm.token,
    body: { movementDate: today(), conceptId: concept("TRASLADO"), warehouseId: wh("MP"), targetWarehouseId: wh("PT"), lines: [{ productId: mp.json.id, quantity: 1, lotId: lotB }] }
  });
  check("tampoco puede trasladar hacia un almacén ajeno", trfOut.code === "OUT_OF_SCOPE", trfOut.json);
  const kxOther = await call("GET", `/inventory/stock/kardex?productId=${mp.json.id}&warehouseId=${wh("PLANTA")}`, { token: alm.token });
  check("ni consultar el kárdex de otro almacén", kxOther.status === 403);
  const cantReverse = await call("POST", `/inventory/movements/${out1.json.id}/reverse`, { token: alm.token });
  check("el rol Almacenista no puede reversar (requiere Eliminar)", cantReverse.status === 403, cantReverse.json);
  const noProducts = await call("GET", "/inventory/products", { token: alm.token });
  check("sin asignación en Productos → 403", noProducts.status === 403);
  const lookupProducts = await call("GET", `/lookups/products?search=MP-${T}`, { token: alm.token });
  check("pero puede buscar productos para sus movimientos (lookup sin costos)", lookupProducts.json?.[0]?.code === `MP-${T}` && lookupProducts.json[0].purchasePrice === undefined, lookupProducts.json);

  section("Catálogos de inventario (motor genérico)");
  const concepts = (await call("GET", "/settings/catalogs/movement-concepts", { token: admin })).json;
  const sys = concepts.find((c) => c.code === "REC_COMPRA");
  const delSys = await call("DELETE", `/settings/catalogs/movement-concepts/${sys.id}`, { token: admin });
  check("un concepto del sistema no se elimina", delSys.code === "SYSTEM_RECORD", delSys.json);
  const lockSys = await call("PATCH", `/settings/catalogs/movement-concepts/${sys.id}`, { token: admin, body: { moduleCode: "INVENTORY" } });
  check("ni se cambia su módulo (dejaría usarlo a mano)", lockSys.code === "SYSTEM_RECORD", lockSys.json);
  const renameSys = await call("PATCH", `/settings/catalogs/movement-concepts/${sys.id}`, { token: admin, body: { name: "Recepción de compras" } });
  check("pero sí se puede renombrar", renameSys.status === 200, renameSys.json);
  const manualBuy = await call("POST", "/inventory/movements", {
    token: admin,
    body: { movementDate: today(), conceptId: sys.id, warehouseId: wh("MP"), lines: [{ productId: me.json.id, quantity: 1, unitCost: 1 }] }
  });
  check("un concepto de Compras no se usa en movimientos manuales", manualBuy.code === "CONCEPT_NOT_MANUAL", manualBuy.json);
  const unitsDenied = await call("GET", "/settings/catalogs/units", { token: alm.token });
  check("catálogos de inventario exigen INV_CATALOGS (no basta otra asignación)", unitsDenied.status === 403);
}
