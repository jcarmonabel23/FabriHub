/**
 * @project FabriHub
 * @file scripts/smoke/reports-more.mjs
 * @description Reportes de análisis y gestión: ventas por hora, familia, cajero, descuentos y clientes;
 * pedidos pendientes y cumplimiento; rotación, kárdex, ajustes y costos; proveedores, precios, OC
 * pendientes y gasto; eficiencia, costos, consumo, calidad y carga de producción; libro de ventas,
 * retenciones, documentos fiscales, diferencial cambiario, resumen gerencial y ventas por empresa.
 *
 * Usa los datos que dejan las suites anteriores (Venezuela, base VES; Costa Rica para comprobantes).
 */

import { API, adminSession, call, check, section } from "./_client.mjs";

const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;
const kpi = (p, key) => p?.summary?.kpis?.find((k) => k.key === key);
const total = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
const daysAgo = (n) => new Date(Date.parse(`${today()}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export async function run() {
  const admin = await adminSession();
  const get = (code, qs = "") => call("GET", `/dashboard/reports/${code}/preview${qs}`, { token: admin });
  const preview = async (code, qs = "") => (await get(code, qs)).json;
  const month = `?from=${daysAgo(30)}&to=${today()}`;
  const year = `?from=${daysAgo(365)}&to=${today()}`;

  section("Lista por país");
  const list = (await call("GET", "/dashboard/reports", { token: admin })).json.map((r) => r.code);
  const veOnly = ["WITHHOLDINGS", "FISCAL_DOCS", "Z_REPORTS"];
  check("Venezuela: retenciones, documentos fiscales y reportes Z, sin comprobantes de Hacienda", veOnly.every((c) => list.includes(c)) && !list.includes("EINVOICES"), list);
  check("el resumen gerencial encabeza la lista", list[0] === "MANAGEMENT_SUMMARY", list.slice(0, 3));
  const hidden = await get("EINVOICES");
  check("un reporte de otro país → 404", hidden.status === 404, hidden.json);

  section("Análisis de ventas");
  const daily = await preview("SALES_DAILY", month);
  const net = total(daily.rows, "net");
  const posNet = total(daily.rows, "posNet");
  const hours = await preview("SALES_HOURS", month);
  check("por hora: la venta cuadra con el cierre diario", near(total(hours.rows, "net"), net), { hours: total(hours.rows, "net"), net });
  check(
    "por hora: cada fila reparte su venta entre los días de la semana",
    hours.rows.every((r) => near(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].reduce((s, d) => s + Number(r[d]), 0), r.net)),
    hours.rows[0]
  );
  check("por hora: mapa de calor con los 7 días y hora pico", hours.summary.charts[0]?.kind === "heatmap" && hours.summary.charts[0].series.length === 7 && kpi(hours, "peakHour")?.value, hours.summary.charts[0]?.series);

  const fam = await preview("SALES_FAMILY", month);
  check("por familia: cuadra con el cierre y las participaciones suman 100 %", near(total(fam.rows, "net"), net) && near(total(fam.rows, "share"), 1, 0.001), fam.rows.slice(0, 3));

  const cashiers = await preview("SALES_CASHIERS", month);
  check("por cajero: la venta neta es la de la caja", near(total(cashiers.rows, "net"), posNet, 0.1), { cashiers: total(cashiers.rows, "net"), posNet });
  check("por cajero: ticket promedio = venta / tickets", cashiers.rows.every((r) => !r.tickets || near(r.avgTicket, r.net / r.tickets)), cashiers.rows);

  const disc = await preview("DISCOUNTS", year);
  check(
    "descuentos: solo documentos con descuento y su porcentaje sobre el subtotal",
    disc.rows.every((r) => r.discount > 0 && near(r.discountPct, r.discount / r.subtotal, 0.0001) && r.authorizedBy),
    disc.rows.slice(0, 3)
  );

  section("Clientes y pedidos");
  const top = await preview("TOP_CUSTOMERS", month);
  check("clientes: cuadra con el cierre y el mostrador va aparte sin posición", near(total(top.rows, "net"), net) && top.rows.every((r) => (r.kind === "Mostrador") === (r.rank === null)), top.rows.slice(0, 4));
  check("clientes: posiciones correlativas por venta", top.rows.filter((r) => r.rank).every((r, i, a) => r.rank === i + 1 && (i === 0 || r.net <= a[i - 1].net)));
  const inactive = await get("INACTIVE_CUSTOMERS", `?from=${today()}&to=${today()}`);
  check("inactivos: compraron antes del rango y no en él", inactive.status === 200 && inactive.json.rows.every((r) => r.lastDay < today() && r.daysSince >= 1), inactive.json.rows?.slice(0, 2));

  const backlog = await preview("SO_BACKLOG");
  check("OV pendientes: solo líneas con saldo, con su atraso", backlog.rows.every((r) => r.pending > 0 && r.daysLate >= 0 && ["Sí", "Parcial", "No"].includes(r.canShip)), backlog.rows.slice(0, 2));
  const otif = await preview("DELIVERY_PERFORMANCE", year);
  check(
    "cumplimiento: cada OV con su resultado y el OTIF en el resumen",
    otif.total > 0 && otif.rows.every((r) => r.result && r.fillRate >= 0 && r.fillRate <= 1) && kpi(otif, "otif")?.value !== undefined,
    otif.rows.slice(0, 2)
  );

  section("Inventario");
  const kardex = await preview("KARDEX", month);
  check(
    "kárdex: saldo final = inicial + entradas − salidas (cantidad y valor)",
    kardex.total > 0 && kardex.rows.every((r) => near(r.closingQty, r.openingQty + r.inQty - r.outQty, 0.001) && near(r.closingValue, r.openingValue + r.inValue - r.outValue, 0.05)),
    kardex.rows.slice(0, 2)
  );
  const turn = await preview("INVENTORY_TURNOVER", month);
  check("rotación: el valor final cuadra con el kárdex", near(total(turn.rows, "closingValue"), total(kardex.rows, "closingValue"), 0.5), { turn: total(turn.rows, "closingValue"), kardex: total(kardex.rows, "closingValue") });
  check("rotación: estado según los días de inventario", turn.rows.every((r) => (r.days === null) === (r.status === "Sin salidas")), turn.rows.slice(0, 3));
  const adj = await preview("ADJUSTMENTS", year);
  check("ajustes: las salidas restan y las entradas suman", adj.rows.every((r) => Math.sign(r.quantity) === Math.sign(r.value) || r.value === 0), adj.rows.slice(0, 2));
  const cost = await get("COST_VARIATION", year);
  check("variación de costo: responde con su estado", cost.status === 200 && cost.json.rows.every((r) => r.status && r.costBefore > 0), cost.json.rows?.slice(0, 2));

  section("Compras");
  const perf = await preview("SUPPLIER_PERFORMANCE", year);
  check("proveedores: cumplimiento entre 0 y 100 % y evaluación", perf.total > 0 && perf.rows.every((r) => r.fillRate >= 0 && r.fillRate <= 1 && r.rating), perf.rows.slice(0, 2));
  check("proveedores: cuenta el lote rechazado por calidad", total(perf.rows, "rejected") >= 1, perf.rows.map((r) => [r.supplier, r.lots, r.rejected]));
  const spend = await preview("PURCHASE_SPEND", year);
  check("gasto: cuadra con lo comprado a los proveedores", near(total(spend.rows, "amount"), total(perf.rows, "amount"), 0.5), { spend: total(spend.rows, "amount"), perf: total(perf.rows, "amount") });
  const prices = await preview("PURCHASE_PRICES", year);
  check("precios: el último está entre el mínimo y el máximo", prices.total > 0 && prices.rows.every((r) => r.lastPrice >= r.minPrice - 1e-6 && r.lastPrice <= r.maxPrice + 1e-6), prices.rows.slice(0, 2));
  const pending = await preview("PO_PENDING");
  check("OC pendientes: saldo y monto por línea", pending.rows.every((r) => r.pending > 0 && r.amount >= 0) && near(kpi(pending, "amount")?.value, total(pending.rows, "amount")), pending.rows.slice(0, 2));

  section("Producción y calidad");
  const eff = await preview("PRODUCTION_EFFICIENCY", year);
  check("eficiencia: rendimiento = fabricado / planificado", eff.total > 0 && eff.rows.every((r) => near(r.yield, r.produced / r.planned, 0.0001)), eff.rows.slice(0, 2));
  const variance = await preview("PRODUCTION_COST_VARIANCE", year);
  check(
    "costos: variación = real − estándar por componente",
    variance.rows.every((r) => near(r.variance, r.realMaterial + r.realLabor + r.realOverhead - r.stdMaterial - r.stdLabor - r.stdOverhead)) && variance.summary.charts[0]?.data.length === 3,
    variance.rows.slice(0, 1)
  );
  const cons = await preview("MATERIAL_CONSUMPTION", year);
  check("consumo: diferencia = real − teórico", cons.total > 0 && cons.rows.every((r) => near(r.diff, r.consumed - r.theoretical, 0.0001)), cons.rows.slice(0, 2));
  const qc = await preview("LOT_QUALITY", year);
  check("calidad: aprobados y rechazados con su origen", ["Aprobado", "Rechazado"].every((d) => qc.rows.some((r) => r.decision === d)) && qc.rows.every((r) => r.origin), qc.rows.map((r) => [r.lotCode, r.decision, r.origin]));
  const load = await preview("PRODUCTION_LOAD");
  check("carga: OP abiertas con su plazo y faltantes", load.rows.every((r) => ["Atrasada", "En curso", "Por iniciar"].includes(r.timing) && (r.missing > 0) === Boolean(r.missingList)), load.rows.slice(0, 2));

  section("Fiscal y tesorería");
  const book = await preview("SALES_BOOK", month);
  check(
    "libro de ventas: total = exento + gravado + impuesto + IGTF; anulados en cero",
    book.total > 0 && book.rows.every((r) => (r.status === "Anulado" ? r.total === 0 : near(r.total, r.exempt + r.taxed + r.tax + r.igtf, 0.02))),
    book.rows.slice(0, 2)
  );
  const wh = await preview("WITHHOLDINGS", year);
  check("retenciones: las practicadas a proveedores", wh.rows.some((r) => r.kind === "Practicada" && r.amount > 0) && kpi(wh, "made")?.value > 0, wh.rows.slice(0, 2));
  const fiscal = await get("FISCAL_DOCS", year);
  const z = await get("Z_REPORTS", year);
  check("documentos fiscales y reportes Z responden", fiscal.status === 200 && z.status === 200, { fiscal: fiscal.status, z: z.status });
  const fx = await preview("FX_DIFFERENTIAL", month);
  check("diferencial: valor a la tasa de hoy − venta del día", fx.rows.every((r) => r.differential === null || near(r.differential, r.today - r.net)) && near(total(fx.rows, "net"), net), fx.rows.slice(0, 2));

  section("Gerencial");
  const mgmt = await preview("MANAGEMENT_SUMMARY", month);
  const row = (k) => mgmt.rows.find((r) => r.indicator === k);
  check("resumen: venta neta del período igual al cierre diario", near(row("Venta neta")?.value, net, 0.02) && near(kpi(mgmt, "net")?.value, net, 0.02), mgmt.rows.slice(0, 2));
  check(
    "resumen: compara con el período anterior y con el año pasado; el inventario es foto de hoy",
    row("Venta neta")?.previous !== undefined && "lastYear" in row("Venta neta") && row("Valor del inventario (hoy)")?.previous === null,
    mgmt.rows
  );
  const companies = await preview("COMPANIES_SALES", month);
  const ve = companies.rows.find((r) => r.currency === "VES");
  check("por empresa: una fila por empresa con su moneda y en USD", companies.total >= 2 && near(ve?.net, net, 0.02) && companies.rows.every((r) => r.netUsd !== undefined), companies.rows);
  check("por empresa: participaciones en USD suman 100 %", near(total(companies.rows, "share"), 1, 0.001) || total(companies.rows, "netUsd") === 0, companies.rows.map((r) => r.share));

  const xlsx = await fetch(`${API}/dashboard/reports/SALES_HOURS/xlsx`, { headers: { authorization: `Bearer ${admin}` } });
  const buf = Buffer.from(await xlsx.arrayBuffer());
  check("el Excel del mapa de calor trae resumen y detalle", xlsx.status === 200 && buf.includes("xl/worksheets/sheet2.xml"), { status: xlsx.status });

  section("Costa Rica");
  const meCompany = (await call("GET", "/auth/me", { token: admin })).json.company;
  const cr = (await call("GET", "/admin/companies", { token: admin })).json.find((c) => c.countryCode === "CR");
  await call("POST", "/auth/switch-company", { token: admin, body: { companyId: cr.id } });
  try {
    const listCR = (await call("GET", "/dashboard/reports", { token: admin })).json.map((r) => r.code);
    check("Costa Rica: comprobantes electrónicos, sin retenciones ni documentos de Venezuela", listCR.includes("EINVOICES") && veOnly.every((c) => !listCR.includes(c)), listCR);
    const einv = await preview("EINVOICES", year);
    check(
      "comprobantes: aceptados y rechazados con el mensaje de Hacienda",
      einv.rows.some((r) => r.status === "Aceptado") && einv.rows.filter((r) => r.status === "Rechazado").every((r) => r.message) && kpi(einv, "accepted")?.value > 0,
      einv.rows.map((r) => [r.docType, r.status, r.message])
    );
  } finally {
    await call("POST", "/auth/switch-company", { token: admin, body: { companyId: meCompany.id } });
  }
}
