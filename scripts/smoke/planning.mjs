/**
 * @project FabriHub
 * @file scripts/smoke/planning.mjs
 * @description Suite de humo de la fase 7: períodos, plan de ventas, plan maestro (MPS), MRP multinivel
 * (código de nivel más bajo, neteo, tamaño de lote, explosión) y conversión de sugerencias en OP/OC con permisos.
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-5);
  const product = async (code) => (await call("GET", `/lookups/products?search=${code}`, { token: admin })).json.find((p) => p.code === code);
  const [para, almidon] = await Promise.all([product("PT-PARA500-20"), product("MP-ALMIDON")]);

  section("Períodos y plan de ventas");
  const periods = (await call("GET", "/planning/periods", { token: admin })).json;
  const demo = periods.find((p) => p.salesProducts === 3);
  check("período de demostración con plan de ventas de 3 productos", Boolean(demo), periods);
  const year = demo.year + 1;
  const created = await call("POST", "/planning/periods", { token: admin, body: { code: `P${year}-${T}`, name: `Plan ${year} prueba`, year, copyFromId: demo.id } });
  check("período del año siguiente copiando el plan de ventas", created.status === 201 && created.json.salesProducts === 3, created.json);
  const dup = await call("POST", "/planning/periods", { token: admin, body: { code: `P${year}-${T}`, name: "Duplicado", year } });
  check("código de período repetido → 409", dup.status === 409, dup.json);
  const pid = created.json.id;

  const notSold = await call("PUT", `/planning/periods/${pid}/plans`, { token: admin, body: { type: "sales", rows: [{ productId: almidon.id, months: Array(12).fill(1) }] } });
  check("una materia prima no va en el plan de ventas", notSold.code === "NOT_SOLD", notSold.json);
  const notMade = await call("PUT", `/planning/periods/${pid}/plans`, { token: admin, body: { type: "mps", rows: [{ productId: almidon.id, months: Array(12).fill(1) }] } });
  check("ni en el plan maestro (no se fabrica)", notMade.code === "NOT_MANUFACTURED", notMade.json);
  const sales = [1200, 1200, 1300, 1400, 1500, 1600, 1700, 1600, 1500, 1500, 1800, 2000];
  const saved = await call("PUT", `/planning/periods/${pid}/plans`, { token: admin, body: { type: "sales", rows: [{ productId: para.id, months: sales }] } });
  const plans1 = (await call("GET", `/planning/periods/${pid}/plans`, { token: admin })).json;
  check("plan de ventas mensual guardado (12 meses por producto)", saved.status === 204 && plans1.products.find((p) => p.id === para.id)?.sales.join() === sales.join(), plans1.products);
  check("un período futuro se planifica desde enero", plans1.firstMonth === 1, plans1.firstMonth);

  const empty = await call("POST", "/planning/periods", { token: admin, body: { code: `V${year}-${T}`, name: "Vacío", year } });
  const noMps = await call("POST", `/planning/periods/${empty.json.id}/mrp`, { token: admin });
  check("sin plan maestro no se corre el MRP", noMps.code === "NO_MPS", noMps.json);
  await call("DELETE", `/planning/periods/${empty.json.id}`, { token: admin });

  section("Plan maestro (MPS)");
  const gen = await call("POST", `/planning/periods/${pid}/mps`, { token: admin });
  check("MPS generado para los 3 terminados", gen.json?.generated === 3 && gen.json.skipped.length === 0, gen.json);
  const plans = (await call("GET", `/planning/periods/${pid}/plans`, { token: admin })).json;
  const p = plans.products.find((x) => x.id === para.id);
  check("el MPS se programa en lotes de la fórmula (múltiplos de 1.000 cajas)", p.mps.every((q) => q % 1000 === 0) && p.mps.some((q) => q > 0), p.mps);
  let poh = p.available;
  let ok = true;
  for (let m = 0; m < 12; m++) {
    poh += p.mps[m] - p.sales[m];
    if (poh < p.safetyStock - 1e-6) ok = false;
  }
  check("el disponible proyectado nunca cae bajo el stock de seguridad", ok, { available: p.available, safety: p.safetyStock, mps: p.mps, sales: p.sales });
  const manual = [...p.mps];
  manual[0] += 1000;
  const edited = await call("PUT", `/planning/periods/${pid}/plans`, { token: admin, body: { type: "mps", rows: [{ productId: para.id, months: manual }] } });
  check("el planificador puede ajustar el MPS a mano", edited.status === 204);

  section("MRP");
  const runRes = await call("POST", `/planning/periods/${pid}/mrp`, { token: admin });
  const r = runRes.json;
  check("corrida del MRP sobre el horizonte del parámetro (3 meses)", runRes.status === 200 && r.months === 3 && r.firstMonth === 1, runRes.json);
  const row = (code) => r.results.find((x) => x.code === code);
  check("códigos de nivel: terminado 0, granulado 1, paracetamol polvo 2", row("PT-PARA500-20")?.level === 0 && row("SE-GRAN-PARA")?.level === 1 && row("MP-PARACETAMOL")?.level === 2, r.results.map((x) => `${x.code}:${x.level}`));
  check("las necesidades brutas del terminado son su plan de ventas", row("PT-PARA500-20").buckets[0].gross === sales[0], row("PT-PARA500-20").buckets);
  const gran = row("SE-GRAN-PARA");
  const paraRelease = row("PT-PARA500-20").buckets;
  check(
    "explosión: brutas del granulado = lanzamientos de tabletas × 11,1 kg/1.000 × 1,01",
    gran.buckets.every((b, i) => near(b.gross, (paraRelease[i].release / 1000) * 11.1 * 1.01, 1e-3)),
    { gran: gran.buckets.map((b) => b.gross), releases: paraRelease.map((b) => b.release) }
  );
  const balanced = r.results.every((x) => x.buckets.every((b, i) => i === 0 || near(b.projected, x.buckets[i - 1].projected + b.scheduled + b.receipt - b.gross, 1e-3)));
  check("tabla MRP cuadra: disponible = anterior + programadas + planificadas − brutas", balanced);
  const sug = r.suggestions;
  const buys = sug.filter((s) => s.kind === "buy");
  const makes = sug.filter((s) => s.kind === "make");
  check("sugiere fabricar terminados y comprar insumos", makes.some((s) => s.productCode === "PT-PARA500-20") && buys.length > 0, sug.map((s) => `${s.kind}:${s.productCode}`));
  check("compras redondeadas a unidades de compra enteras (millares de empaque)", buys.every((s) => near(s.quantity / s.purchaseFactor, Math.round(s.quantity / s.purchaseFactor))), buys);
  const acid = buys.find((s) => s.productCode === "MP-ACIDO-ASC");
  check("proveedor sugerido desde su lista de precios (ácido ascórbico → Quimiven)", /Química del Centro/.test(acid?.supplierName ?? ""), acid);
  check("la fecha de lanzamiento se adelanta el tiempo de reposición", sug.every((s) => s.releaseDate <= s.dueDate), sug.map((s) => [s.productCode, s.releaseDate, s.dueDate]));

  section("Convertir sugerencias");
  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const role = (slug) => roles.find((x) => x.slug === slug).id;
  const planner = await createUserWith(admin, `mrp.${T}@fabrihub.local`, "Planificador MRP", [{ moduleCode: "PRD_PLANNING", roleIds: [role("planner")], permissions: [] }]);
  const makeSug = makes.find((s) => s.productCode === "PT-PARA500-20");
  const noPerm = await call("POST", "/planning/suggestions/convert", { token: planner.token, body: { ids: [makeSug.id] } });
  check("planificar no da permiso para crear OP: sin PRD_ORDERS → 403", noPerm.status === 403 && noPerm.code === "NO_DOCUMENT_PERMISSION", noPerm.json);

  const conv = await call("POST", "/planning/suggestions/convert", { token: admin, body: { ids: [makeSug.id] } });
  const opDoc = conv.json?.documents?.[0];
  const op = await call("GET", `/production/orders/${opDoc?.id}`, { token: admin });
  check("fabricar → OP en estado «planificada» con la cantidad sugerida", op.json?.status === "planned" && op.json.quantityPlanned === makeSug.quantity && /^OP-/.test(opDoc.number), op.json);
  check("la sugerencia queda convertida con el número del documento", conv.json.run.suggestions.find((s) => s.id === makeSug.id)?.documentNumber === opDoc.number);
  const again = await call("POST", "/planning/suggestions/convert", { token: admin, body: { ids: [makeSug.id] } });
  check("no se convierte dos veces", again.code === "NOT_OPEN", again.json);

  const buy = buys[0];
  await call("PATCH", `/planning/suggestions/${buy.id}`, { token: admin, body: { supplierId: null } });
  const noSupplier = await call("POST", "/planning/suggestions/convert", { token: admin, body: { ids: [buy.id] } });
  check("una compra sin proveedor no se convierte", noSupplier.code === "SUPPLIER_REQUIRED", noSupplier.json);
  const suppliers = (await call("GET", "/lookups/suppliers", { token: admin })).json;
  const supplierId = buy.supplierId ?? suppliers.find((s) => s.code === "QUIMIVEN").id;
  await call("PATCH", `/planning/suggestions/${buy.id}`, { token: admin, body: { supplierId } });
  const sameGroup = buys.filter((s) => s.id !== buy.id && (s.supplierId ?? supplierId) === supplierId && s.warehouseId === buy.warehouseId).slice(0, 1);
  const convBuy = await call("POST", "/planning/suggestions/convert", { token: admin, body: { ids: [buy.id, ...sameGroup.map((s) => s.id)] } });
  const ocDoc = convBuy.json?.documents?.[0];
  const oc = await call("GET", `/purchases/orders/${ocDoc?.id}`, { token: admin });
  const group = [buy, ...sameGroup].filter((g) => g.productId === buy.productId);
  const ocQty = (oc.json?.lines ?? []).filter((l) => l.productId === buy.productId).reduce((t, l) => t + l.quantity * l.unitFactor, 0);
  check("comprar → OC en borrador (una por proveedor y almacén)", convBuy.json?.documents?.length === 1 && oc.json?.status === "draft" && oc.json.lines.length === 1 + sameGroup.length, convBuy.json);
  check("la OC va en unidad de compra (cantidad × factor = lo sugerido)", near(ocQty, group.reduce((t, g) => t + g.quantity, 0)), { ocQty, group });

  const toDismiss = sug.find((s) => s.id !== makeSug.id && s.id !== buy.id && !sameGroup.some((g) => g.id === s.id));
  const dismissed = await call("POST", `/planning/suggestions/${toDismiss.id}/dismiss`, { token: admin });
  check("descartar una sugerencia", dismissed.json?.suggestions?.find((s) => s.id === toDismiss.id)?.status === "dismissed", dismissed.json);

  section("Cierre del período");
  const del = await call("DELETE", `/planning/periods/${pid}`, { token: admin });
  check("un período que ya generó órdenes no se elimina", del.code === "HAS_DOCUMENTS", del.json);
  const closed = await call("PATCH", `/planning/periods/${pid}`, { token: admin, body: { status: "closed" } });
  const rerun = await call("POST", `/planning/periods/${pid}/mrp`, { token: admin });
  check("período cerrado: solo consulta (no se corre el MRP)", closed.json?.status === "closed" && rerun.code === "PERIOD_CLOSED", rerun.json);
  const runs = await call("GET", `/planning/periods/${pid}/runs`, { token: admin });
  check("historial de corridas con lo convertido", runs.json?.[0]?.converted >= 2, runs.json);

  // Limpieza: la OP planificada no debe quedar como recepción programada para otras pruebas
  await call("POST", `/production/orders/${opDoc.id}/cancel`, { token: admin, body: { reason: "Fin de la prueba del MRP" } });
  await call("POST", `/purchases/orders/${ocDoc.id}/cancel`, { token: admin, body: { reason: "Fin de la prueba del MRP" } });
}
