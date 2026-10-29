/**
 * @project FabriHub
 * @file scripts/smoke/companies.mjs
 * @description Fase 10: empresas, cambio de empresa, alcance de módulos (plataforma / global) y miembros.
 *
 * No abre sesiones nuevas (el límite por IP ya está casi agotado): usa la del administrador y la de
 * un usuario creado en una suite anterior (knownUsers), al que solo se le reasignan módulos.
 */

import { adminSession, call, check, knownUsers, section } from "./_client.mjs";

const T = Date.now().toString(36).toUpperCase();

export async function run() {
  const admin = await adminSession();

  section("Empresas (administrador de plataforma)");
  const me = await call("GET", "/auth/me", { token: admin });
  const companyA = me.json?.company;
  check("la sesión trae la empresa activa", companyA?.code === "PRINCIPAL", me.json?.company);
  check("el administrador inicial es de plataforma", me.json?.user?.isPlatformAdmin === true, me.json?.user);
  check("ve el módulo Empresas", me.json?.modules?.some((m) => m.code === "ADM_COMPANIES" && m.permissions.includes("add_new")));

  const list = await call("GET", "/admin/companies", { token: admin });
  const principal = list.json?.find?.((c) => c.code === "PRINCIPAL");
  check("lista las empresas", Boolean(principal), list.json);

  const code = `SUC-${T}`.slice(0, 20);
  const created = await call("POST", "/admin/companies", {
    token: admin,
    body: { code, legalName: "Sucursal de prueba, C.A.", rif: "J-12345678-0", baseCurrencyId: principal.baseCurrencyId }
  });
  const companyB = created.json;
  check("crea una empresa", created.status === 201 && companyB?.isActive, created.json);
  check("quien la crea queda como miembro", companyB?.membersCount === 1, companyB);
  const dup = await call("POST", "/admin/companies", {
    token: admin,
    body: { code, legalName: "Otra", rif: "J-12345678-0", baseCurrencyId: principal.baseCurrencyId }
  });
  check("código de empresa repetido → 409", dup.code === "CODE_TAKEN", dup.json);
  const badRif = await call("POST", "/admin/companies", {
    token: admin,
    body: { code: `X${code}`.slice(0, 20), legalName: "Otra", rif: "123", baseCurrencyId: principal.baseCurrencyId }
  });
  check("RIF inválido → 400", badRif.status === 400, badRif.json);

  const mine = await call("GET", "/auth/companies", { token: admin });
  check("mis empresas incluye la nueva", mine.json?.some?.((c) => c.id === companyB.id), mine.json);

  section("Cambio de empresa");
  const productsA = await call("GET", "/inventory/products?pageSize=1", { token: admin });
  const paramsA = await call("GET", "/settings/parameters", { token: admin });
  const termsA = await call("GET", "/settings/catalogs/payment-terms", { token: admin });

  const sw = await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyB.id } });
  check("cambia a la empresa nueva", sw.json?.company?.id === companyB.id, sw.json);
  const productsB = await call("GET", "/inventory/products?pageSize=1", { token: admin });
  check("la empresa nueva no ve productos de la otra", productsA.json?.total > 0 && productsB.json?.total === 0, productsB.json);
  const paramsB = await call("GET", "/settings/parameters", { token: admin });
  check("nace con los parámetros de la plantilla", paramsB.json?.length === paramsA.json?.length, paramsB.json?.length);
  const termsB = await call("GET", "/settings/catalogs/payment-terms", { token: admin });
  check("nace con los catálogos comerciales de la plantilla", termsB.json?.length === termsA.json?.length, termsB.json);
  const whB = await call("POST", "/inventory/warehouses", { token: admin, body: { code: "MP", name: "Materia prima B", kind: "storage" } });
  check("el mismo código de almacén vale en otra empresa", whB.status === 201, whB.json);
  const settingsB = await call("GET", "/settings/company", { token: admin });
  check("Empresa muestra los datos de la activa", settingsB.json?.rif === "J-12345678-0", settingsB.json);

  const stale = await call("GET", "/inventory/products", { token: admin, headers: { "x-company-id": companyA.id } });
  check("pestaña que quedó en otra empresa → 409 COMPANY_CHANGED", stale.code === "COMPANY_CHANGED", stale.json);
  const foreign = await call("POST", "/auth/switch-company", {
    token: admin,
    body: { companyId: "00000000-0000-4000-8000-000000000000" }
  });
  check("cambiar a una empresa ajena → 403", foreign.code === "COMPANY_FORBIDDEN", foreign.json);

  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyA.id } });
  const whA = await call("GET", "/inventory/warehouses", { token: admin });
  check("de vuelta: solo sus almacenes", whA.json?.filter?.((w) => w.code === "MP").length === 1, whA.json);

  section("Alcance de los módulos (administrador de empresa)");
  const user = knownUsers.at(-1);
  const lookups = await call("GET", "/admin/users/lookups", { token: admin });
  const adminRole = lookups.json.roles.find((r) => r.slug === "admin").id;
  check("los módulos de plataforma no se asignan", !lookups.json.modules.some((m) => m.code === "ADM_COMPANIES"));
  const asAdmin = (moduleCode) => ({ moduleCode, roleIds: [adminRole], permissions: [] });
  await call("PUT", `/admin/users/${user.id}/modules`, {
    token: admin,
    body: { assignments: ["ADM_USERS", "TAX_TAXES", "INV_CATALOGS", "INV_PRODUCTS"].map(asAdmin) }
  });

  const uMe = await call("GET", "/auth/me", { token: user.token });
  check("un administrador de empresa no es de plataforma", uMe.json?.user?.isPlatformAdmin === false, uMe.json?.user);
  check(
    "no ve Empresas, Roles ni Módulos",
    !uMe.json?.modules?.some((m) => ["ADM_COMPANIES", "ADM_ROLES", "ADM_MODULES"].includes(m.code)),
    uMe.json?.modules?.map((m) => m.code)
  );
  const taxPerms = uMe.json?.modules?.find((m) => m.code === "TAX_TAXES")?.permissions ?? [];
  check("en un módulo global solo conserva la lectura", taxPerms.includes("view") && !taxPerms.includes("add_new"), taxPerms);
  check("GET /admin/companies → 403", (await call("GET", "/admin/companies", { token: user.token })).status === 403);
  check("GET /admin/roles → 403", (await call("GET", "/admin/roles", { token: user.token })).status === 403);
  check("lee impuestos", (await call("GET", "/taxes/taxes", { token: user.token })).status === 200);
  const newTax = await call("POST", "/taxes/taxes", { token: user.token, body: { code: "X", name: "X" } });
  check("no crea impuestos (globales) → 403", newTax.status === 403, newTax.json);
  const unit = await call("POST", "/settings/catalogs/units", { token: user.token, body: { code: `U${T}`.slice(0, 20), name: "Unidad", decimals: 0 } });
  check("no crea unidades (catálogo global) → 403 PLATFORM_ONLY", unit.code === "PLATFORM_ONLY", unit.json);
  const family = await call("POST", "/settings/catalogs/product-families", { token: user.token, body: { code: `F${T}`.slice(0, 20), name: "Familia" } });
  check("sí crea familias (catálogo de su empresa)", family.status === 201, family.json);
  const adminId = me.json.user.id;
  const kick = await call("DELETE", `/admin/users/${adminId}/membership`, { token: user.token });
  check("no retira de la empresa a un administrador de plataforma", kick.code === "PLATFORM_ADMIN", kick.json);

  section("Miembros");
  const dupUser = await call("POST", "/admin/users", { token: admin, body: { email: user.email, names: "Repetido" } });
  check("alta de alguien que ya es miembro → 409", dupUser.code === "ALREADY_MEMBER", dupUser.json);
  const add = await call("POST", `/admin/companies/${companyB.id}/members`, { token: admin, body: { email: user.email } });
  check("agrega un usuario existente a otra empresa", add.status === 201 && add.json?.created === false, add.json);
  const uCompanies = await call("GET", "/auth/companies", { token: user.token });
  check("el usuario ve sus dos empresas", uCompanies.json?.length === 2, uCompanies.json);

  const uSw = await call("POST", "/auth/switch-company", { token: user.token, body: { companyId: companyB.id } });
  check("en la otra empresa no trae los permisos de la primera", uSw.json?.modules?.every((m) => m.permissions.length === 0), uSw.json?.modules);
  check("sin permisos ahí → 403", (await call("GET", "/inventory/products", { token: user.token })).status === 403);

  const members = await call("GET", `/admin/companies/${companyB.id}/members`, { token: admin });
  check("la empresa lista sus miembros", members.json?.length === 2, members.json);
  const out = await call("DELETE", `/admin/companies/${companyB.id}/members/${user.id}`, { token: admin });
  check("retira al usuario de la empresa", out.status === 200 || out.status === 204, out.json);
  const after = await call("GET", "/inventory/products", { token: user.token, headers: { "x-company-id": companyB.id } });
  check("su sesión abierta pasa sola a su otra empresa (→ 409 para recargar)", after.code === "COMPANY_CHANGED", after.json);
  const back = await call("GET", "/auth/me", { token: user.token });
  check("y queda en la empresa que le queda", back.json?.company?.id === companyA.id, back.json?.company);

  section("Suspensión");
  const own = await call("PATCH", `/admin/companies/${companyA.id}`, { token: admin, body: { isActive: false } });
  check("no suspende la empresa en la que trabaja", own.code === "ACTIVE_COMPANY", own.json);
  const off = await call("PATCH", `/admin/companies/${companyB.id}`, { token: admin, body: { isActive: false } });
  check("suspende otra empresa", off.json?.isActive === false, off.json);
  const toOff = await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyB.id } });
  check("no se entra a una empresa suspendida", toOff.code === "COMPANY_FORBIDDEN", toOff.json);

  // El usuario reutilizado vuelve a quedar sin módulos extra
  await call("PUT", `/admin/users/${user.id}/modules`, { token: admin, body: { assignments: [] } });
}
