/**
 * @project FabriHub
 * @file scripts/smoke/production.mjs
 * @description Suite de humo de la fase 5: maestros (etapas, centros, rutas, fórmulas), explosión e
 * implosión, y el ciclo completo de una orden de producción: liberar (reserva FEFO), consumir,
 * seguimiento por etapa, confirmar (lote en cuarentena), Calidad y cierre con costeo real vs. estándar.
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-6);
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;
  const [stages, wcTypes, centers, workCenters, warehouses] = await Promise.all([
    lk("stages"),
    lk("work-center-types"),
    lk("production-centers"),
    lk("work-centers"),
    lk("warehouses")
  ]);
  const id = (list, code) => list.find((x) => x.code === code)?.id;
  const product = async (code) => (await call("GET", `/lookups/products?search=${code}`, { token: admin })).json.find((p) => p.code === code);
  const [pt, gran, almidon, blister] = await Promise.all([product("PT-PARA500-20"), product("SE-GRAN-PARA"), product("MP-ALMIDON"), product("ME-BLISTER")]);

  section("Maestros de producción");
  const stage = await call("POST", "/settings/catalogs/stages", { token: admin, body: { code: `ETQ${T}`, name: "Etiquetado de prueba" } });
  check("etapa nueva con el motor de catálogos (PRD_STAGES)", stage.status === 201, stage.json);
  const center = await call("POST", "/production/centers", {
    token: admin,
    body: { code: `LIQ${T}`, name: "Líquidos de prueba", stageIds: [stage.json.id], outputWarehouseId: id(warehouses, "PT") }
  });
  check("centro de producción con sus etapas", center.status === 201 && center.json.stages.length === 1, center.json);
  const wc = await call("POST", "/production/work-centers", {
    token: admin,
    body: {
      code: `ENV${T}`,
      name: "Envasadora de prueba",
      workCenterTypeId: id(wcTypes, "MAQUINA"),
      productionCenterId: center.json.id,
      capacityHoursDay: 8,
      efficiencyPct: 90,
      laborRate: 5,
      overheadRate: 7
    }
  });
  check("centro de trabajo con tarifas", wc.status === 201 && wc.json.laborRate === 5, wc.json);
  const badRoute = await call("POST", "/production/routes", {
    token: admin,
    body: {
      code: `R${T}`,
      name: "Ruta inválida",
      productionCenterId: center.json.id,
      baseQuantity: 100,
      steps: [{ sequence: 10, stageId: stage.json.id, workCenterId: id(workCenters, "BLI-01"), setupHours: 1, runHours: 1 }]
    }
  });
  check("una ruta no usa centros de trabajo de otro centro de producción", badRoute.code === "WORK_CENTER_OUTSIDE", badRoute.json);
  const route = await call("POST", "/production/routes", {
    token: admin,
    body: {
      code: `R${T}`,
      name: "Ruta de prueba",
      productionCenterId: center.json.id,
      baseQuantity: 100,
      steps: [{ sequence: 10, stageId: stage.json.id, workCenterId: wc.json.id, setupHours: 0.5, runHours: 2 }]
    }
  });
  check("ruta con tiempos teóricos", route.status === 201 && route.json.steps.length === 1 && route.json.baseHours === 2.5, route.json);
  const stageInUse = await call("DELETE", `/settings/catalogs/stages/${stage.json.id}`, { token: admin });
  check("una etapa usada en una ruta no se elimina", stageInUse.status === 409, stageInUse.json);

  const notMade = await call("POST", "/production/formulas", {
    token: admin,
    body: { productId: almidon.id, code: `FX${T}`, name: "Fórmula inválida", baseQuantity: 1, lines: [{ componentId: blister.id, quantity: 1 }] }
  });
  check("solo los productos fabricados llevan fórmula", notMade.code === "NOT_MANUFACTURED", notMade.json);

  const formulas = (await call("GET", `/production/formulas?productId=${gran.id}`, { token: admin })).json;
  const granFormula = (await call("GET", `/production/formulas/${formulas[0].id}`, { token: admin })).json;
  const cycle = await call("PUT", `/production/formulas/${granFormula.id}`, {
    token: admin,
    body: {
      name: granFormula.name,
      baseQuantity: granFormula.baseQuantity,
      routeId: granFormula.routeId,
      isDefault: true,
      lines: [...granFormula.lines.map((l) => ({ componentId: l.componentId, quantity: l.quantity, scrapPct: l.scrapPct, isCritical: l.isCritical })), { componentId: pt.id, quantity: 1 }]
    }
  });
  check("una fórmula circular (granulado ← tabletas ← granulado) se rechaza", cycle.status === 400 && /Ciclo/.test(cycle.json?.error?.message), cycle.json);
  const granAfter = (await call("GET", `/production/formulas/${granFormula.id}`, { token: admin })).json;
  check("la fórmula queda intacta tras el rechazo", granAfter.lines.length === granFormula.lines.length, granAfter.lines);

  section("Explosión e implosión");
  const exp = await call("GET", `/production/formulas/explode?productId=${pt.id}&quantity=1000`, { token: admin });
  const granRow = exp.json?.items?.find((r) => r.componentCode === "SE-GRAN-PARA");
  check("explosión multinivel: 3 componentes directos + 3 del granulado", exp.json?.items?.length === 6 && exp.json.items.filter((r) => r.level === 2).length === 3, exp.json);
  check("cantidad con merma: 11,1 kg × 1,01 = 11,211 kg de granulado", near(granRow?.quantity, 11.211, 1e-6), granRow);
  check("verificar existencia: sin faltantes críticos para 1.000 cajas", exp.json?.criticalShortages === 0, exp.json);
  const big = await call("GET", `/production/formulas/explode?productId=${pt.id}&quantity=5000`, { token: admin });
  check("para 5.000 cajas falta granulado (crítico)", big.json?.criticalShortages === 1, big.json);
  const imp = await call("GET", `/production/formulas/implode?productId=${almidon.id}`, { token: admin });
  check("implosión del almidón: granulado (nivel 1) y tabletas (nivel 2)", imp.json?.some((r) => r.level === 1 && r.productCode === "SE-GRAN-PARA") && imp.json?.some((r) => r.level === 2 && r.productCode === "PT-PARA500-20"), imp.json);

  section("Orden de producción: crear y liberar");
  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const role = (slug) => roles.find((r) => r.slug === slug).id;
  const planner = await createUserWith(admin, `planificador.${T}@fabrihub.local`, "Planificador", [
    { moduleCode: "PRD_ORDERS", roleIds: [role("planner")], permissions: [] }
  ]);

  const base = { plannedStart: today(), priority: 2 };
  const op = await call("POST", "/production/orders", { token: planner.token, body: { ...base, productId: pt.id, quantity: 1000 } });
  check("el planificador crea la OP (fórmula por defecto, centro y almacenes de la ruta)", op.status === 201 && op.json.status === "created" && op.json.formulaCode === "F-PARA500-1", op.json);
  check("materiales = explosión de un nivel; procesos = etapas de la ruta", op.json?.lines?.length === 3 && op.json?.processes?.length === 3, op.json);
  const opGran = op.json.lines.find((l) => l.productCode === "SE-GRAN-PARA");
  const opBlister = op.json.lines.find((l) => l.productCode === "ME-BLISTER");
  check("cada material se toma del almacén que lo tiene (granulado en MP, blíster en ME)", opGran?.warehouseCode === "MP" && opBlister?.warehouseCode === "ME", op.json.lines);
  check("horas estándar = preparación + ejecución escalada (compresión 1 + 1,5 = 2,5 h)", op.json.processes[0].stdHours === 2.5, op.json.processes);
  check("costo estándar calculado (materiales, mano de obra y fabril)", op.json.stdMaterialCost > 0 && op.json.stdLaborCost > 0 && op.json.stdOverheadCost > 0, op.json);

  const plannerRelease = await call("POST", `/production/orders/${op.json.id}/release`, { token: planner.token });
  check("el planificador no puede liberar (falta el permiso release) → 403", plannerRelease.status === 403, plannerRelease.json);

  const opBig = await call("POST", "/production/orders", { token: admin, body: { ...base, productId: pt.id, quantity: 5000 } });
  const bigRelease = await call("POST", `/production/orders/${opBig.json.id}/release`, { token: admin });
  check("liberar con faltante crítico → 409 CRITICAL_SHORTAGE con el detalle", bigRelease.code === "CRITICAL_SHORTAGE" && bigRelease.json.error.details?.some((d) => d.productCode === "SE-GRAN-PARA"), bigRelease.json);
  const bigAfter = await call("GET", `/production/orders/${opBig.json.id}`, { token: admin });
  check("la orden sigue creada y sin reservas (todo se revirtió)", bigAfter.json.status === "created" && bigAfter.json.lines.every((l) => l.quantityReserved === 0), bigAfter.json.lines);
  const bigCancel = await call("POST", `/production/orders/${opBig.json.id}/cancel`, { token: admin, body: { reason: "Excede el granulado disponible" } });
  check("anular una orden creada", bigCancel.json?.status === "cancelled", bigCancel.json);

  const granBefore = (await call("GET", `/production/orders/${op.json.id}/availability`, { token: admin })).json.items.find((i) => i.productCode === "SE-GRAN-PARA");
  const released = await call("POST", `/production/orders/${op.json.id}/release`, { token: admin });
  check("liberar → released, todo reservado", released.json?.status === "released" && released.json.lines.every((l) => near(l.quantityReserved, l.quantityRequired, 1e-6)), released.json);
  check("reserva por lote (FEFO) en el granulado", released.json.lines.find((l) => l.productCode === "SE-GRAN-PARA").reservations[0]?.lotCode === "GP-2601", released.json.lines);
  const granAfterRel = (await call("GET", `/production/orders/${op.json.id}/availability`, { token: admin })).json.items.find((i) => i.productCode === "SE-GRAN-PARA");
  check("lo reservado deja de estar disponible", near(granBefore.available - granAfterRel.available, 11.211, 1e-6), { granBefore, granAfterRel });

  const concepts = (await call("GET", "/inventory/movements/form-options", { token: admin })).json;
  const ajNeg = concepts.concepts?.find((c) => c.code === "AJ_NEG") ?? concepts.find?.((c) => c.code === "AJ_NEG");
  const lotGP = (await call("GET", `/inventory/lots?search=GP-2601`, { token: admin })).json.items?.[0];
  const steal = await call("POST", "/inventory/movements", {
    token: admin,
    body: { conceptId: ajNeg?.id, movementDate: today(), warehouseId: id(warehouses, "MP"), lines: [{ productId: gran.id, lotId: lotGP?.id, quantity: 30 }] }
  });
  check("un ajuste manual no puede sacar lo reservado para la OP", steal.status === 400 && /insuficiente/.test(steal.json?.error?.message), steal.json);

  section("Consumo y seguimiento");
  const early = await call("POST", `/production/orders/${op.json.id}/confirm`, { token: admin, body: { quantity: 1000, lotCode: `L${T}` } });
  check("no se confirma una orden que no ha empezado", early.code === "INVALID_STATUS", early.json);
  const consumed = await call("POST", `/production/orders/${op.json.id}/consume`, { token: admin, body: {} });
  check("consumir lo reservado → en proceso, consumido = requerido", consumed.json?.status === "in_process" && consumed.json.lines.every((l) => near(l.quantityConsumed, l.quantityRequired, 1e-6) && l.quantityReserved === 0), consumed.json);
  check("una salida CONS_PROD por almacén (MP y ME)", consumed.json?.movements?.filter((m) => m.conceptCode === "CONS_PROD").length === 2, consumed.json?.movements);
  check("costo real de materiales al promedio ponderado", consumed.json.lines.find((l) => l.productCode === "SE-GRAN-PARA").consumedCost > 0, consumed.json.lines);

  const tracking = (await call("GET", "/production/tracking", { token: admin })).json.filter((p) => p.orderId === op.json.id);
  check("seguimiento: tres etapas pendientes de la orden", tracking.length === 3, tracking);
  const outOfOrder = await call("POST", `/production/tracking/${tracking[1].id}/start`, { token: admin });
  check("las etapas van en orden (no se inicia la 2.ª antes de terminar la 1.ª)", outOfOrder.code === "PREVIOUS_PENDING", outOfOrder.json);
  const prematureConfirm = await call("POST", `/production/orders/${op.json.id}/confirm`, { token: admin, body: { quantity: 1000, lotCode: `L${T}` } });
  check("no se confirma con etapas pendientes", prematureConfirm.code === "PROCESSES_PENDING", prematureConfirm.json);
  const hours = [2.8, 0.5, 2.4];
  for (const [i, p] of tracking.entries()) {
    await call("POST", `/production/tracking/${p.id}/start`, { token: admin });
    await call("POST", `/production/tracking/${p.id}/finish`, { token: admin, body: { realHours: hours[i], quantityGood: 990, quantityScrap: i === 0 ? 10 : 0 } });
  }
  const afterTracking = await call("GET", `/production/orders/${op.json.id}`, { token: admin });
  check("tres etapas terminadas con sus horas reales", afterTracking.json.processesDone === 3 && afterTracking.json.processes[0].realHours === 2.8, afterTracking.json.processes);

  section("Confirmar, Calidad y cierre");
  const noLot = await call("POST", `/production/orders/${op.json.id}/confirm`, { token: admin, body: { quantity: 990 } });
  check("el terminado se maneja por lote: hay que indicarlo", noLot.code === "LOT_REQUIRED", noLot.json);
  const confirmed = await call("POST", `/production/orders/${op.json.id}/confirm`, { token: admin, body: { quantity: 990, lotCode: `L${T}` } });
  const c = confirmed.json;
  check("confirmar → lote nuevo en CUARENTENA en el almacén PT", c?.status === "confirmed" && c.outputLotStatus === "quarantine" && c.outputWarehouseCode === "PT", c);
  const labor = 2.8 * 8 + 0.5 * 9 + 2.4 * 10;
  const overhead = 2.8 * 22 + 0.5 * 6 + 2.4 * 20;
  check("costo real = materiales consumidos + horas reales × tarifas", near(c.realLaborCost, labor) && near(c.realOverheadCost, overhead), c);
  check("costo unitario real = total ÷ 990 cajas", near(c.realUnitCost, (c.realMaterialCost + c.realLaborCost + c.realOverheadCost) / 990, 1e-5), c);

  const qcSelf = await call("POST", `/quality/lots/${c.outputLotId}/approve`, { token: admin, body: { notes: "Conforme" } });
  check("quien confirmó la producción no libera su lote (segregación)", qcSelf.status === 403, qcSelf.json);
  const qc = await createUserWith(admin, `calidad.prd.${T}@fabrihub.local`, "Analista de calidad", [{ moduleCode: "QC_LOTS", roleIds: [role("quality")], permissions: [] }]);
  const qcOk = await call("POST", `/quality/lots/${c.outputLotId}/approve`, { token: qc.token, body: { notes: "Disolución y valoración conformes", analysisRef: "CA-PT-001" } });
  check("Calidad libera el lote fabricado", qcOk.status === 200, qcOk.json);
  const stockPt = await call("GET", `/inventory/stock?productId=${pt.id}`, { token: admin });
  const ptLot = stockPt.json.items.find((r) => r.lotCode === `L${T}`);
  check("el lote fabricado entra al inventario de PT (990 cajas)", ptLot?.quantity === 990, stockPt.json.items);
  const reverse = await call("POST", `/inventory/movements/${c.outputMovementId}/reverse`, { token: admin });
  check("la entrada de producción no se reversa desde Inventario", reverse.code === "REVERSE_FROM_SOURCE", reverse.json);

  const plannerClose = await call("POST", `/production/orders/${op.json.id}/close`, { token: planner.token });
  check("el planificador no cierra (falta el permiso close) → 403", plannerClose.status === 403, plannerClose.json);
  const closed = await call("POST", `/production/orders/${op.json.id}/close`, { token: admin });
  const std = (closed.json.stdMaterialCost + closed.json.stdLaborCost + closed.json.stdOverheadCost) / 1000 * 990;
  const real = closed.json.realMaterialCost + closed.json.realLaborCost + closed.json.realOverheadCost;
  check("cerrar → variación = real − estándar de lo fabricado", closed.json?.status === "closed" && near(closed.json.variance, real - std, 0.001), closed.json);
  const delClosed = await call("DELETE", `/production/orders/${op.json.id}`, { token: admin });
  check("una orden cerrada no se elimina", delClosed.code === "INVALID_STATUS", delClosed.json);

  section("Devolver a creada y eliminar");
  const op3 = await call("POST", "/production/orders", { token: admin, body: { ...base, productId: pt.id, quantity: 100, lotCode: `M${T}` } });
  await call("POST", `/production/orders/${op3.json.id}/release`, { token: admin });
  const unrel = await call("POST", `/production/orders/${op3.json.id}/unrelease`, { token: admin });
  check("devolver a creada suelta las reservas", unrel.json?.status === "created" && unrel.json.lines.every((l) => l.quantityReserved === 0), unrel.json);
  const edited = await call("PUT", `/production/orders/${op3.json.id}`, { token: admin, body: { ...base, quantity: 200, lotCode: `M${T}` } });
  check("editar la cantidad recalcula materiales y horas", edited.json?.quantityPlanned === 200 && near(edited.json.lines.find((l) => l.productCode === "ME-CAJA-PARA20").quantityRequired, 202), edited.json);
  const del = await call("DELETE", `/production/orders/${op3.json.id}`, { token: admin });
  check("una orden creada se elimina", del.status === 204, del.json);
}
