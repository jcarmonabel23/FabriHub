/**
 * @project FabriHub
 * @file scripts/smoke/countries.mjs
 * @description Fase 15: país de la empresa (Venezuela / Costa Rica). Impuestos y tratamientos por
 * país, identificación fiscal según el país, moneda local, zona horaria e IGTF solo en Venezuela.
 *
 * No abre sesiones nuevas: crea la empresa de Costa Rica con la sesión del administrador y se cambia a ella.
 */

import { adminSession, call, check, section } from "./_client.mjs";

const T = Date.now().toString(36).toUpperCase();

export async function run() {
  const admin = await adminSession();
  const me = await call("GET", "/auth/me", { token: admin });
  const companyVE = me.json?.company;

  section("Catálogo de países");
  check("la sesión trae el país de la empresa", companyVE?.country?.code === "VE" && companyVE?.country?.taxIdLabel === "RIF", companyVE?.country);
  const countries = await call("GET", "/lookups/countries", { token: admin });
  const cr = countries.json?.find?.((c) => c.code === "CR");
  check("Venezuela y Costa Rica en el catálogo", countries.json?.length >= 2 && cr?.currencyCode === "CRC", countries.json);
  const currencies = await call("GET", "/settings/catalogs/currencies", { token: admin });
  check("moneda colón (CRC)", currencies.json?.some?.((c) => c.code === "CRC"), currencies.json?.map?.((c) => c.code));
  const treatmentsVE = (await call("GET", "/taxes/treatments", { token: admin })).json;

  section("Empresa en Costa Rica");
  const code = `CR-${T}`.slice(0, 20);
  const badId = await call("POST", "/admin/companies", {
    token: admin,
    body: { code, countryCode: "CR", legalName: "Tienda Tica, S.A.", rif: "J-12345678-9" }
  });
  check("un RIF no es cédula de Costa Rica → 400", badId.status === 400 && badId.code === "INVALID_TAX_ID", badId.json);
  const created = await call("POST", "/admin/companies", {
    token: admin,
    body: { code, countryCode: "CR", legalName: "Tienda Tica, S.A.", rif: "3-101-123456" }
  });
  const companyCR = created.json;
  check("crea la empresa con cédula jurídica (normalizada)", created.status === 201 && companyCR?.rif === "3101123456" && companyCR?.idType === "JURIDICA", companyCR);
  check("país CR y moneda base colón por defecto", companyCR?.countryCode === "CR" && companyCR?.baseCurrencyCode === "CRC", companyCR);

  const sw = await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyCR.id } });
  const country = sw.json?.company?.country;
  check("la sesión trae Costa Rica", country?.code === "CR" && country?.taxIdLabel === "Cédula" && country?.timezone === "America/Costa_Rica", country);
  check("en Costa Rica no hay IGTF ni contribuyente especial", country?.features?.igtf === false && country?.features?.specialTaxpayer === false, country?.features);

  try {
    section("Impuestos de Costa Rica");
    const taxes = (await call("GET", "/taxes/taxes", { token: admin })).json;
    const iva = taxes?.find?.((t) => t.code === "IVA");
    check("IVA 13 % con tarifas reducidas 4, 2 y 1 %", iva?.rates?.find((r) => r.code === "G13")?.rate === 13 && ["R4", "R2", "R1"].every((c) => iva.rates.some((r) => r.code === c)), iva);
    check("no ve las tarifas de Venezuela", !iva?.rates?.some((r) => r.code === "G"), iva?.rates);
    const whs = (await call("GET", "/taxes/withholdings", { token: admin })).json;
    check("no ve las retenciones de Venezuela", Array.isArray(whs) && !whs.some((w) => w.code === "ISLR"), whs);
    const treatments = (await call("GET", "/taxes/treatments", { token: admin })).json;
    check("tratamientos de Costa Rica (G13, EXENTO)", ["G13", "EXENTO"].every((c) => treatments?.some?.((t) => t.code === c)), treatments?.map?.((t) => t.code));
    check("sin tratamientos de Venezuela", !treatments?.some?.((t) => t.code.startsWith("G16")), treatments?.map?.((t) => t.code));
    const g13 = treatments?.find?.((t) => t.code === "G13");
    const sim = await call("POST", `/taxes/treatments/${g13?.id}/simulate`, { token: admin, body: { amount: 1000 } });
    check("simulación: 1000 + IVA 13 % = 1130", JSON.stringify(sim.json).includes("130"), sim.json);

    section("Identificación de clientes y proveedores");
    const cust = await call("POST", "/sales/customers", {
      token: admin,
      body: { code: `CF${T}`.slice(0, 20), legalName: "María Rodríguez", rif: "1-0234-0567" }
    });
    check("cédula física: se detecta el tipo y se normaliza", cust.status === 201 && cust.json?.idType === "FISICA" && cust.json?.rif === "102340567", cust.json);
    check("el país del cliente es Costa Rica", cust.json?.country === "Costa Rica", cust.json?.country);
    const dimex = await call("POST", "/sales/customers", {
      token: admin,
      body: { code: `CD${T}`.slice(0, 20), legalName: "John Smith", idType: "DIMEX", rif: "184000123456" }
    });
    check("DIMEX con tipo explícito", dimex.status === 201 && dimex.json?.idType === "DIMEX", dimex.json);
    const veRif = await call("POST", "/sales/customers", {
      token: admin,
      body: { code: `CV${T}`.slice(0, 20), legalName: "Otro", rif: "J-12345678-9" }
    });
    check("un RIF venezolano → 400", veRif.status === 400, veRif.json);
    const wrongType = await call("POST", "/sales/customers", {
      token: admin,
      body: { code: `CW${T}`.slice(0, 20), legalName: "Otro", idType: "RIF", rif: "102340567" }
    });
    check("tipo de otro país (RIF) → 400", wrongType.status === 400, wrongType.json);
    const foreignTreatment = treatmentsVE?.[0]?.id;
    const crossTreat = await call("POST", "/sales/customers", {
      token: admin,
      body: { code: `CX${T}`.slice(0, 20), legalName: "Otro", rif: "3101654321", fiscalTreatmentId: foreignTreatment }
    });
    check("tratamiento fiscal de Venezuela → 400", crossTreat.status === 400, crossTreat.json);
    const sup = await call("POST", "/purchases/suppliers", {
      token: admin,
      body: { code: `PJ${T}`.slice(0, 20), legalName: "Distribuidora Central, S.A.", rif: "3-101-777888" }
    });
    check("proveedor con cédula jurídica", sup.status === 201 && sup.json?.idType === "JURIDICA" && sup.json?.rif === "3101777888", sup.json);

    section("Datos de la empresa e IGTF");
    const settings = (await call("GET", "/settings/company", { token: admin })).json;
    check("Empresa: país fijo y cédula jurídica", settings?.countryCode === "CR" && settings?.idType === "JURIDICA", settings);
    const special = await call("PUT", "/settings/company", { token: admin, body: { ...settings, isSpecialTaxpayer: true } });
    check("contribuyente especial no aplica en Costa Rica (queda en falso)", special.status === 200 && special.json?.isSpecialTaxpayer === false, special.json);
    const params = (await call("GET", "/settings/parameters", { token: admin })).json;
    const igtfParam = params?.find?.((p) => p.moduleCode === "POS" && p.key === "igtf_enabled");
    if (igtfParam) await call("PATCH", `/settings/parameters/${igtfParam.id}`, { token: admin, body: { value: true } });
    const pos = await call("GET", "/pos/me", { token: admin });
    check("IGTF apagado en Costa Rica aunque el parámetro esté activo", pos.status === 200 && pos.json?.settings?.igtfEnabled === false, pos.json?.settings);
  } finally {
    await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyVE.id } });
  }

  section("De vuelta en Venezuela");
  const taxesVE = (await call("GET", "/taxes/taxes", { token: admin })).json;
  const ivaVE = taxesVE?.find?.((t) => t.code === "IVA");
  check("Venezuela sigue viendo su IVA (G, R, EX)", ["G", "R", "EX"].every((c) => ivaVE?.rates?.some((r) => r.code === c)) && !ivaVE.rates.some((r) => r.code === "G13"), ivaVE?.rates);
  const ci = await call("POST", "/sales/customers", {
    token: admin,
    body: { code: `VC${T}`.slice(0, 20), legalName: "Pedro Pérez", rif: "v12345678" }
  });
  check("cédula venezolana: tipo CI y formato V-12345678", ci.status === 201 && ci.json?.idType === "CI" && ci.json?.rif === "V-12345678", ci.json);
  const crId = await call("POST", "/sales/customers", {
    token: admin,
    body: { code: `VX${T}`.slice(0, 20), legalName: "Otro", rif: "3101123456" }
  });
  check("una cédula jurídica de Costa Rica no vale en Venezuela → 400", crId.status === 400, crId.json);
}
