/**
 * @project FabriHub
 * @file scripts/smoke/dashboard.mjs
 * @description Suite de humo de la fase 8: detector de alertas (deduplicación, resolución, destinatarios por
 * permiso y almacén, correo), campana, indicadores con alcance y reportes Excel con permisos.
 */

import { API, adminSession, call, check, createUserWith, lastMailText, section, sleep } from "./_client.mjs";

/** Corrida manual; si justo corre la programada (409 ALERTS_RUNNING), reintenta */
async function runAlerts(token) {
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", "/dashboard/alerts/run", { token });
    if (r.code !== "ALERTS_RUNNING") return r;
    await sleep(500);
  }
  throw new Error("El detector sigue ocupado");
}

async function download(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), buf };
}

export async function run() {
  const admin = await adminSession();
  const T = Date.now().toString().slice(-6);
  const lk = async (name) => (await call("GET", `/lookups/${name}`, { token: admin })).json;
  const [units, types, warehouses] = await Promise.all([lk("units"), lk("product-types"), lk("warehouses")]);
  const wh = (c) => warehouses.find((w) => w.code === c).id;
  const roles = (await call("GET", "/admin/roles", { token: admin })).json;
  const role = (slug) => roles.find((r) => r.slug === slug).id;

  section("Detector de alertas");
  const first = await runAlerts(admin);
  check("corrida manual del detector", first.status === 200 && first.json.openAlerts > 0, first.json);
  const second = await runAlerts(admin);
  check("una situación vigente no se duplica: la segunda corrida no crea alertas nuevas", second.json.newAlerts === 0 && second.json.openAlerts === first.json.openAlerts, second.json);
  const open = (await call("GET", "/dashboard/alerts?status=open&pageSize=200", { token: admin })).json;
  const kinds = new Set(open.items.map((a) => a.kind));
  check("detecta stock bajo el mínimo y lotes vencidos de las fases anteriores", kinds.has("STOCK_MIN") && kinds.has("LOT_EXPIRED"), [...kinds]);
  check("las vencidas son críticas", open.items.filter((a) => a.kind === "LOT_EXPIRED").every((a) => a.severity === "critical"));
  const summary = (await call("GET", "/dashboard/alerts/summary", { token: admin })).json;
  check("resumen por severidad cuadra con la lista", summary.total === open.total && summary.lastRun?.finishedAt, summary);

  // Un solo usuario de prueba (cada login gasta el límite por IP): almacenista del almacén PT, sin view_all.
  // Los permisos se evalúan en cada petición, así que para los casos sin permiso se le cambian los módulos.
  const FULL = [
    { moduleCode: "INV_STOCK", roleIds: [role("warehouse")], permissions: [] },
    { moduleCode: "DSH_ALERTS", roleIds: [role("viewer")], permissions: [] },
    { moduleCode: "DSH_INDICATORS", roleIds: [role("viewer")], permissions: [] },
    { moduleCode: "DSH_REPORTS", roleIds: [role("buyer")], permissions: [] }
  ];
  const almPT = await createUserWith(admin, `dsh.pt.${T}@fabrihub.local`, "Almacenista PT", FULL);
  await call("PUT", `/admin/users/${almPT.id}/warehouses`, { token: admin, body: { warehouseIds: [wh("PT")] } });
  const assign = (assignments) => call("PUT", `/admin/users/${almPT.id}/modules`, { token: admin, body: { assignments } });

  section("Destinatarios por permiso y almacén");
  const product = await call("POST", "/inventory/products", {
    token: admin,
    body: { code: `dsh-${T}`, name: "Estuche de prueba del tablero", productTypeId: types.find((t) => t.code === "ME").id, stockUnitId: units.find((u) => u.code === "UND").id, isPurchased: true }
  });
  const pid = product.json.id;
  await call("PUT", `/inventory/warehouses/${wh("PT")}/policies/${pid}`, { token: admin, body: { minQty: 10 } });
  await call("PUT", `/inventory/warehouses/${wh("MP")}/policies/${pid}`, { token: admin, body: { minQty: 10 } });
  const third = await runAlerts(admin);
  check("dos políticas sin existencia → 2 alertas nuevas", third.json.newAlerts === 2, third.json);

  const mine = (await call("GET", "/dashboard/alerts?status=open&search=DSH-" + T, { token: almPT.token })).json;
  check("el almacenista PT ve solo la alerta de su almacén", mine.total === 1 && mine.items[0].warehouseCode === "PT", mine.items);
  check("sin existencia la alerta es crítica", mine.items[0]?.severity === "critical", mine.items[0]);
  const all = (await call("GET", "/dashboard/alerts?status=open&search=DSH-" + T, { token: admin })).json;
  check("el administrador (view_all) ve ambas", all.total === 2, all.items);

  const bellPT = (await call("GET", "/notifications?unread=true", { token: almPT.token })).json;
  const ptNote = bellPT.items.find((n) => n.title.includes(`DSH-${T}`));
  check("la campana del almacenista recibe el aviso de su almacén y no el del otro", bellPT.unread === 1 && Boolean(ptNote), bellPT);
  const mail = await lastMailText(`dsh.pt.${T}@fabrihub.local`);
  check("correo de resumen con la alerta nueva", mail.includes(`DSH-${T}`) && /alerta/i.test(mail), mail.slice(0, 300));

  const foreign = await call("POST", `/notifications/${ptNote.id}/read`, { token: admin });
  check("no se puede marcar la notificación de otro usuario → 404", foreign.status === 404, foreign.json);
  const read = await call("POST", `/notifications/${ptNote.id}/read`, { token: almPT.token });
  const afterRead = (await call("GET", "/notifications", { token: almPT.token })).json;
  check("marcar como leída", read.status === 204 && afterRead.unread === 0 && afterRead.items[0].isRead, afterRead);

  const forbiddenRun = await call("POST", "/dashboard/alerts/run", { token: almPT.token });
  check("lanzar el detector exige configure → 403", forbiddenRun.status === 403, forbiddenRun.json);

  section("Resolución");
  await call("DELETE", `/inventory/warehouses/${wh("PT")}/policies/${pid}`, { token: admin });
  const fourth = await runAlerts(admin);
  check("al quitar la política la alerta se resuelve", fourth.json.resolvedAlerts >= 1 && fourth.json.newAlerts === 0, fourth.json);
  const resolved = (await call("GET", "/dashboard/alerts?status=resolved&search=DSH-" + T, { token: admin })).json;
  check("queda en el historial de resueltas", resolved.items.some((a) => a.warehouseCode === "PT" && a.resolvedAt), resolved.items);
  const bellAfter = (await call("GET", "/notifications", { token: almPT.token })).json;
  check("la campana la marca como resuelta", bellAfter.items.find((n) => n.id === ptNote.id)?.isResolved === true, bellAfter.items);
  await call("PUT", `/inventory/warehouses/${wh("PT")}/policies/${pid}`, { token: admin, body: { minQty: 10 } });
  const fifth = await runAlerts(admin);
  const bellAgain = (await call("GET", "/notifications?unread=true", { token: almPT.token })).json;
  check("si la situación vuelve, es una alerta nueva y avisa otra vez", fifth.json.newAlerts === 1 && bellAgain.unread === 1, { run: fifth.json, bell: bellAgain.unread });
  const readAll = await call("POST", "/notifications/read-all", { token: almPT.token });
  check("marcar todo como leído", readAll.json?.updated === 1, readAll.json);

  const params = (await call("GET", "/settings/parameters", { token: admin })).json;
  const emailParam = params.find((p) => p.moduleCode === "DASHBOARD" && p.key === "alerts_email");
  check("parámetros del detector en Parámetros (Tablero)", Boolean(emailParam) && params.some((p) => p.key === "alerts_interval_minutes"), params.filter((p) => p.moduleCode === "DASHBOARD"));
  await call("PATCH", `/settings/parameters/${emailParam.id}`, { token: admin, body: { value: false } });
  await call("DELETE", `/inventory/warehouses/${wh("PT")}/policies/${pid}`, { token: admin });
  await runAlerts(admin);
  await assign(FULL.filter((a) => a.moduleCode !== "INV_STOCK"));
  await call("PUT", `/inventory/warehouses/${wh("PT")}/policies/${pid}`, { token: admin, body: { minQty: 10 } });
  const quiet = await runAlerts(admin);
  check("con el correo apagado se notifica en la campana pero no se envía correo", quiet.json.newAlerts === 1 && quiet.json.notifications >= 1 && quiet.json.emails === 0, quiet.json);
  const bellNoInv = (await call("GET", "/notifications?unread=true", { token: almPT.token })).json;
  check("sin permiso en Existencias ya no recibe avisos de inventario", bellNoInv.unread === 0, bellNoInv);
  const listNoInv = (await call("GET", "/dashboard/alerts?status=open&pageSize=200", { token: almPT.token })).json;
  check("ni las ve en la lista de alertas", listNoInv.items.every((a) => !a.kind.startsWith("STOCK")), listNoInv.items.map((a) => a.kind));
  await assign(FULL);
  await call("PATCH", `/settings/parameters/${emailParam.id}`, { token: admin, body: { value: true } });

  const runs = (await call("GET", "/dashboard/alerts/runs", { token: admin })).json;
  check("bitácora de corridas con quién las lanzó", runs.length >= 6 && runs[0].trigger === "manual" && runs[0].runBy && runs[0].finishedAt, runs[0]);

  section("Indicadores");
  const ind = await call("GET", "/dashboard/indicators", { token: admin });
  const d = ind.json;
  check("el administrador recibe todos los bloques", ind.status === 200 && d.inventory && d.quality && d.production && d.purchases && d.sales && d.planning, Object.keys(d ?? {}));
  check("series de 6 meses", d.production.monthly.length === 6 && d.sales.monthly.length === 6 && d.purchases.monthly.length === 6);
  check("inventario valorizado con cobertura y rotación", d.inventory.totalValue > 0 && d.inventory.valueByType.length > 0 && d.inventory.outflowCost90 > 0 && d.inventory.turnover > 0, d.inventory);
  check("ventas del mes con margen = venta − costo", d.sales.monthly.every((m) => Math.abs(m.margin - (m.sales - m.cost)) < 0.01) && d.sales.monthly.at(-1).sales > 0, d.sales.monthly);
  check("producción: OP terminadas en el mes", d.production.monthly.at(-1).produced > 0, d.production.monthly);
  check("planificación: última corrida del MRP", Boolean(d.planning.lastRunAt), d.planning);
  const indPT = (await call("GET", "/dashboard/indicators", { token: almPT.token })).json;
  check("el almacenista solo recibe inventario, acotado a su almacén", indPT.inventory?.restricted === true && !indPT.sales && !indPT.production && !indPT.purchases, indPT);
  check("su valor de inventario no incluye otros almacenes", indPT.inventory.totalValue < d.inventory.totalValue, { pt: indPT.inventory.totalValue, all: d.inventory.totalValue });

  section("Reportes");
  const list = (await call("GET", "/dashboard/reports", { token: admin })).json;
  check("el administrador ve los 8 reportes", list.length === 8, list.map((r) => r.code));
  const prev = (await call("GET", "/dashboard/reports/STOCK_VALUED/preview", { token: admin })).json;
  check("vista previa de existencias valoradas", prev.total > 0 && prev.columns.length > 5 && prev.rows[0].productCode, prev);
  const xlsx = await download(admin, "/dashboard/reports/SALES/xlsx");
  check(
    "descarga en Excel (.xlsx real, con nombre de archivo)",
    xlsx.status === 200 && xlsx.type?.includes("spreadsheetml") && xlsx.buf.subarray(0, 2).toString() === "PK" && /FabriHub_SALES_.*\.xlsx/.test(xlsx.disposition ?? ""),
    { status: xlsx.status, type: xlsx.type, disposition: xlsx.disposition }
  );
  const sales = (await call("GET", "/dashboard/reports/SALES/preview", { token: admin })).json;
  check("el reporte de ventas trae lo despachado en el rango", sales.total > 0 && sales.rows.every((r) => Math.abs(r.margin - (r.sales - r.cost)) < 0.01), sales.rows.slice(0, 2));
  const badRange = await call("GET", "/dashboard/reports/MOVEMENTS/preview?from=2026-12-31&to=2026-01-01", { token: admin });
  check("rango invertido → 400", badRange.status === 400, badRange.json);

  const listPT = (await call("GET", "/dashboard/reports", { token: almPT.token })).json.map((r) => r.code);
  check("cada usuario ve los reportes de lo que puede consultar", listPT.includes("STOCK_VALUED") && listPT.includes("ALERTS") && !listPT.includes("PURCHASES"), listPT);
  const prevPT = (await call("GET", "/dashboard/reports/STOCK_VALUED/preview", { token: almPT.token })).json;
  check("el reporte respeta el alcance por almacén", prevPT.total > 0 && prevPT.rows.every((r) => r.warehouse.startsWith("PT ")), prevPT.rows.map((r) => r.warehouse));
  const noSource = await call("GET", "/dashboard/reports/PURCHASES/preview", { token: almPT.token });
  check("reporte de un módulo que no ve → 403 NO_SOURCE_PERMISSION", noSource.code === "NO_SOURCE_PERMISSION", noSource.json);

  section("Permisos de las pantallas");
  await assign([
    { moduleCode: "INV_STOCK", roleIds: [role("warehouse")], permissions: [] },
    { moduleCode: "DSH_REPORTS", roleIds: [role("viewer")], permissions: [] }
  ]);
  const noDownload = await download(almPT.token, "/dashboard/reports/STOCK_VALUED/xlsx");
  check("sin permiso Descargar en Reportes → 403", noDownload.status === 403);
  const noIndicators = await call("GET", "/dashboard/indicators", { token: almPT.token });
  check("sin acceso a Indicadores → 403", noIndicators.status === 403);
  const noAlerts = await call("GET", "/dashboard/alerts", { token: almPT.token });
  check("sin acceso a Alertas → 403", noAlerts.status === 403);
  const bellStill = await call("GET", "/notifications", { token: almPT.token });
  check("la campana no depende de un módulo: sigue disponible", bellStill.status === 200);
}
