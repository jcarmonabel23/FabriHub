/**
 * @project FabriHub
 * @file scripts/smoke/settings-taxes.mjs
 * @description Suite de humo de la fase 2: Parámetros (empresa, parámetros, correlativos, catálogos,
 * tasas de cambio) e Impuestos (impuestos, retenciones, tratamientos y motor de cálculo).
 */

import { adminSession, call, check, createUserWith, section } from "./_client.mjs";

export async function run() {
  const admin = await adminSession();
  // Día de calendario en la zona de la empresa (la BD), no en UTC
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });

  section("Catálogos comerciales (motor genérico)");
  const meta = await call("GET", "/settings/catalogs", { token: admin });
  check("el motor expone los 6 catálogos comerciales", meta.json?.filter((m) => m.module === "SET_COMMERCIAL").length === 6, meta.json);
  const pt = await call("POST", "/settings/catalogs/payment-terms", {
    token: admin,
    body: { code: "cr90", name: "Crédito 90 días", days: 90, appliesTo: "purchases" }
  });
  check("alta normaliza el código a mayúsculas", pt.status === 201 && pt.json.code === "CR90", pt.json);
  const dup = await call("POST", "/settings/catalogs/payment-terms", {
    token: admin,
    body: { code: "CR90", name: "Otra", days: 1, appliesTo: "both" }
  });
  check("código repetido → 409 DUPLICATED (restricción de la BD, no 500)", dup.status === 409 && dup.code === "DUPLICATED", dup.json);
  const badField = await call("POST", "/settings/catalogs/zones", { token: admin, body: { code: "X", name: "Zona X", days: 3 } });
  check("campos que no pertenecen al catálogo se rechazan", badField.status === 400, badField.json);
  const badDays = await call("PATCH", `/settings/catalogs/payment-terms/${pt.json.id}`, { token: admin, body: { days: 999 } });
  check("validación de rango (días ≤ 365)", badDays.status === 400, badDays.json);
  const upd = await call("PATCH", `/settings/catalogs/payment-terms/${pt.json.id}`, { token: admin, body: { days: 75 } });
  check("edición parcial", upd.json?.days === 75, upd.json);
  const del = await call("DELETE", `/settings/catalogs/payment-terms/${pt.json.id}`, { token: admin });
  check("baja de un registro sin uso", del.status === 204);
  const unknown = await call("GET", "/settings/catalogs/users", { token: admin });
  check("solo catálogos registrados (no se puede leer otra tabla por la URL)", unknown.status === 400, unknown.json);

  section("Monedas y tasas de cambio");
  const currencies = await call("GET", "/settings/catalogs/currencies", { token: admin });
  const ves = currencies.json.find((c) => c.code === "VES");
  const usd = currencies.json.find((c) => c.code === "USD");
  const offBase = await call("PATCH", `/settings/catalogs/currencies/${ves.id}`, { token: admin, body: { isActive: false } });
  check("la moneda base no se puede desactivar", offBase.code === "BASE_CURRENCY", offBase.json);
  const baseRate = await call("POST", `/settings/currencies/${ves.id}/rates`, { token: admin, body: { rateDate: today, rate: 2 } });
  check("la moneda base no lleva tasa", baseRate.code === "BASE_CURRENCY", baseRate.json);
  const future = await call("POST", `/settings/currencies/${usd.id}/rates`, { token: admin, body: { rateDate: "2099-01-01", rate: 50 } });
  check("no se registran tasas futuras", future.code === "FUTURE_RATE", future.json);
  await call("POST", `/settings/currencies/${usd.id}/rates`, { token: admin, body: { rateDate: today, rate: 36.5, source: "BCV" } });
  await call("POST", `/settings/currencies/${usd.id}/rates`, { token: admin, body: { rateDate: today, rate: 36.75, source: "BCV" } });
  const rates = await call("GET", `/settings/currencies/${usd.id}/rates`, { token: admin });
  check("una tasa por día: registrar dos veces corrige la del día", rates.json?.length === 1 && rates.json[0].rate === 36.75, rates.json);
  check("las fechas viajan como día de calendario (sin corrimiento por zona horaria)", rates.json?.[0]?.rateDate === today, rates.json?.[0]);

  section("Empresa");
  const company = await call("GET", "/settings/company", { token: admin });
  const badRif = await call("PUT", "/settings/company", { token: admin, body: { ...strip(company.json), rif: "123" } });
  check("RIF con formato inválido → 400", badRif.status === 400, badRif.json);
  const saved = await call("PUT", "/settings/company", {
    token: admin,
    body: { ...strip(company.json), legalName: "Laboratorio Demo, C.A.", rif: "j-12345678-9", isWithholdingAgent: true, phones: ["0212-5551234"] }
  });
  check("datos de la empresa guardados (RIF normalizado)", saved.json?.rif === "J-12345678-9" && saved.json?.isWithholdingAgent, saved.json);
  const audit = await call("GET", "/admin/audit/data?table=company", { token: admin });
  check("el cambio de la empresa queda auditado", audit.json?.items?.[0]?.changedFields?.includes("rif"), audit.json?.items?.[0]);

  section("Parámetros y correlativos");
  const params = await call("GET", "/settings/parameters", { token: admin });
  const expiry = params.json.find((p) => p.key === "expiry_alert_days");
  const costing = params.json.find((p) => p.key === "costing_method");
  const outRange = await call("PATCH", `/settings/parameters/${expiry.id}`, { token: admin, body: { value: 5000 } });
  check("valor fuera de rango → 400", outRange.code === "INVALID_PARAMETER_VALUE", outRange.json);
  const wrongType = await call("PATCH", `/settings/parameters/${expiry.id}`, { token: admin, body: { value: "noventa" } });
  check("valor de otro tipo → 400", wrongType.code === "INVALID_PARAMETER_VALUE", wrongType.json);
  const badOption = await call("PATCH", `/settings/parameters/${costing.id}`, { token: admin, body: { value: "fifo" } });
  check("select solo acepta sus opciones", badOption.code === "INVALID_PARAMETER_VALUE", badOption.json);
  const okParam = await call("PATCH", `/settings/parameters/${expiry.id}`, { token: admin, body: { value: 120 } });
  check("valor válido guardado", okParam.json?.value === 120, okParam.json);
  const reset = await call("POST", `/settings/parameters/${expiry.id}/reset`, { token: admin });
  check("restaurar valor de fábrica", reset.json?.value === 90, reset.json);
  const seqUp = await call("PATCH", "/settings/sequences/PO", { token: admin, body: { prefix: "oc26-", nextNumber: 100 } });
  check("correlativo: vista previa con prefijo y número", seqUp.json?.preview === "OC26-000100", seqUp.json);
  const seqDown = await call("PATCH", "/settings/sequences/PO", { token: admin, body: { nextNumber: 5 } });
  check("el correlativo no retrocede (evita números repetidos)", seqDown.code === "SEQUENCE_BACKWARDS", seqDown.json);

  section("Impuestos y retenciones");
  const taxes = await call("GET", "/taxes/taxes", { token: admin });
  const iva = taxes.json.find((t) => t.code === "IVA");
  check("IVA con tarifas general, reducida y exenta", iva?.rates?.map((r) => r.code).join() === "G,R,EX", iva);
  const badRate = await call("POST", `/taxes/taxes/${iva.id}/rates`, { token: admin, body: { code: "X", name: "Inválida", rate: 150 } });
  check("tarifa > 100% → 400", badRate.status === 400, badRate.json);
  const inUse = await call("DELETE", `/taxes/taxes/${iva.id}`, { token: admin });
  check("no se elimina un impuesto usado por tratamientos (409 IN_USE)", inUse.status === 409 && inUse.code === "IN_USE", inUse.json);

  const whs = await call("GET", "/taxes/withholdings", { token: admin });
  const islr = whs.json.find((w) => w.code === "ISLR");
  check("tarifa ISLR por tramos con 8 tramos (tesis: Tarifa 1 al 4, sin límite)", islr?.rates?.find((r) => r.code === "TARIFA2")?.brackets?.length === 8);
  const dupBr = await call("POST", `/taxes/withholdings/${islr.id}/rates`, {
    token: admin,
    body: { code: "DUP", name: "Tramos repetidos", brackets: [{ fromAmount: 0, rate: 1 }, { fromAmount: 0, rate: 2 }] }
  });
  check("tramos con el mismo monto base → 400", dupBr.status === 400, dupBr.json);
  const newWh = await call("POST", `/taxes/withholdings/${islr.id}/rates`, {
    token: admin,
    body: { code: "FLETES", name: "Fletes (ejemplo)", brackets: [{ fromAmount: 250, rate: 1, subtrahend: 0 }, { fromAmount: 5000, rate: 3, subtrahend: 100 }] }
  });
  check("alta de tarifa con tramos", newWh.status === 201, newWh.json);

  section("Tratamientos fiscales y motor de cálculo");
  const treatments = await call("GET", "/taxes/treatments", { token: admin });
  const riva = treatments.json.find((t) => t.code === "G16_RIVA75");
  const sim = await call("POST", `/taxes/treatments/${riva.id}/simulate`, { token: admin, body: { amount: 1000 } });
  check("simulación G16 + RIVA 75%: IVA 160, retención 120, a pagar 1040",
    sim.json?.tax === 160 && sim.json?.withholding?.amount === 120 && sim.json?.payable === 1040, sim.json);
  const opts = await call("GET", "/taxes/treatments/options", { token: admin });
  const exRate = opts.json.taxRates.find((o) => o.label.includes("Exenta"));
  const islrRate = opts.json.withholdingRates.find((o) => o.label.includes("Escala"));
  const badDates = await call("POST", "/taxes/treatments", {
    token: admin,
    body: { code: "MAL", name: "Fechas", validFrom: "2026-06-01", validTo: "2026-01-01", taxRateId: exRate.value, calcMethod: "product" }
  });
  check("fin de vigencia anterior al inicio → 400", badDates.code === "INVALID_VALIDITY", badDates.json);
  const tr = await call("POST", "/taxes/treatments", {
    token: admin,
    body: { code: "HONOR", name: "Honorarios exentos con ISLR", validFrom: "2026-01-01", taxRateId: exRate.value, withholdingRateId: islrRate.value, calcMethod: "party" }
  });
  check("alta de tratamiento", tr.status === 201 && tr.json.isCurrent, tr.json);
  const sim2 = await call("POST", `/taxes/treatments/${tr.json.id}/simulate`, { token: admin, body: { amount: 20000 } });
  check("simulación ISLR por tramos: 20000 × 16% − 1395 = 1805", sim2.json?.withholding?.amount === 1805, sim2.json);
  await call("PATCH", `/taxes/treatments/${tr.json.id}`, { token: admin, body: { isActive: false } });
  const simOff = await call("POST", `/taxes/treatments/${tr.json.id}/simulate`, { token: admin, body: { amount: 100 } });
  check("un tratamiento inactivo no se puede usar para calcular", simOff.code === "TREATMENT_NOT_VALID", simOff.json);
  const oldDate = await call("POST", `/taxes/treatments/${riva.id}/simulate`, { token: admin, body: { amount: 100, date: "2020-01-01" } });
  check("fuera de vigencia en la fecha del documento → 409", oldDate.code === "TREATMENT_NOT_VALID", oldDate.json);

  section("Permisos de la fase 2");
  const roles = await call("GET", "/admin/roles", { token: admin });
  const viewer = roles.json.find((r) => r.slug === "viewer");
  const consulta = await createUserWith(admin, `consulta.${Date.now()}@fabrihub.local`, "Carla Consulta", [
    { moduleCode: "SET_COMMERCIAL", roleIds: [viewer.id], permissions: [] }
  ]);
  const canRead = await call("GET", "/settings/catalogs/zones", { token: consulta.token });
  check("rol Consulta puede ver catálogos", canRead.status === 200);
  const cantWrite = await call("POST", "/settings/catalogs/zones", { token: consulta.token, body: { code: "SUR", name: "Sur" } });
  check("rol Consulta no puede crear (403 en el servidor)", cantWrite.status === 403, cantWrite.json);
  const cantTaxes = await call("GET", "/taxes/taxes", { token: consulta.token });
  check("sin asignación en Impuestos → 403", cantTaxes.status === 403);
  const lookup = await call("GET", "/lookups/payment-terms?appliesTo=sales", { token: consulta.token });
  check("lookups: cualquier sesión obtiene opciones activas, filtradas por uso",
    lookup.status === 200 && lookup.json.some((x) => x.code === "CONTADO") && !lookup.json.some((x) => x.code === "CR60"), lookup.json);
  const lookupTr = await call("GET", "/lookups/fiscal-treatments", { token: consulta.token });
  check("lookups de tratamientos excluye los inactivos", !lookupTr.json.some((x) => x.code === "HONOR"), lookupTr.json);
}

/** Quita campos de solo lectura de la respuesta de empresa para reenviarla */
function strip(c) {
  const { baseCurrencyCode: _a, updatedAt: _b, ...rest } = c;
  return rest;
}
