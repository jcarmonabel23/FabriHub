/**
 * @project FabriHub
 * @file scripts/smoke/reports.mjs
 * @description Reportes del día a día: cierre diario, productos más y menos vendidos, ABC, margen,
 * arqueos, cobros, reposición, riesgo de quiebre y productos sin movimiento. Resumen (indicadores,
 * comparación con el período anterior, equivalente en USD, gráficos) y Excel con hoja de resumen.
 *
 * Usa las ventas, turnos e inventario que dejan las suites anteriores (Venezuela, base VES).
 */

import { API, adminSession, call, check, section } from "./_client.mjs";

const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;
const kpi = (p, key) => p?.summary?.kpis?.find((k) => k.key === key);
const total = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());

async function download(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

export async function run() {
  const admin = await adminSession();
  const preview = async (code, qs = "") => (await call("GET", `/dashboard/reports/${code}/preview${qs}`, { token: admin })).json;

  section("Ventas");
  const list = (await call("GET", "/dashboard/reports", { token: admin })).json;
  const info = (c) => list.find((r) => r.code === c);
  check("cierre diario: 7 días por defecto; ABC y sin movimiento: 90", info("SALES_DAILY")?.defaultDays === 7 && info("ABC_PRODUCTS")?.defaultDays === 90 && info("SLOW_MOVERS")?.defaultDays === 90, list);

  const daily = await preview("SALES_DAILY");
  const posToday = (await call("GET", `/pos/sales?pageSize=100&from=${today()}&to=${today()}&status=completed`, { token: admin })).json.items;
  const todayRow = daily.rows.find((r) => r.day === today());
  check("cierre diario: una fila por día, el último es hoy", daily.total === 7 && daily.rows.at(-1)?.day === today(), daily.rows.map((r) => r.day));
  check("los tickets de hoy cuentan como documentos", todayRow?.documents >= posToday.length && posToday.length > 0, { row: todayRow, pos: posToday.length });
  check(
    "venta neta = caja + pedidos; margen = venta − costo",
    daily.rows.every((r) => near(r.net, r.posNet + r.soNet) && near(r.margin, r.net - r.cost)),
    daily.rows
  );
  check("indicador de venta = suma del detalle, con su equivalente en USD", near(kpi(daily, "net")?.value, total(daily.rows, "net")) && kpi(daily, "net")?.usd > 0, kpi(daily, "net"));
  check(
    "se compara con la semana anterior",
    daily.summary.previous?.to < daily.from && kpi(daily, "net").previous !== null,
    daily.summary.previous
  );
  check("columna USD (la base es VES) y gráficos de evolución y canal", daily.columns.some((c) => c.key === "netUsd" && c.usd) && daily.summary.charts.some((c) => c.kind === "line"), daily.summary.charts.map((c) => c.title));
  check("sin claves internas en la vista previa", daily.rows.every((r) => !Object.keys(r).some((k) => k.startsWith("_"))));

  const oneDay = await preview("SALES_DAILY", `?from=${today()}&to=${today()}`);
  const weekAgo = new Date(Date.parse(`${today()}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  check("un solo día se compara con el mismo día de la semana pasada", oneDay.summary.previous?.from === weekAgo && oneDay.summary.previous?.to === weekAgo, oneDay.summary.previous);

  const top = await preview("TOP_PRODUCTS");
  const sold = top.rows.filter((r) => r.net > 0);
  check("ranking de mayor a menor venta", top.rows.every((r, i) => i === 0 || r.net <= top.rows[i - 1].net) && top.rows[0].rank === 1, top.rows.slice(0, 3));
  check(
    "participaciones suman 100 % y se listan los activos sin ventas",
    top.total <= 100 ? near(total(top.rows, "share"), 1, 0.001) && kpi(top, "noSales")?.value === top.rows.filter((r) => !r.net).length : sold.length > 0,
    kpi(top, "noSales")
  );
  check("producto líder y los dos rankings", kpi(top, "leader")?.value === top.rows[0].productName && top.summary.charts.length === 2, top.summary.kpis);

  const abc = await preview("ABC_PRODUCTS");
  check(
    "ABC: el primero es clase A, el acumulado cierra en 100 % y las clases no retroceden",
    abc.rows[0]?.class === "A" && (abc.total > abc.rows.length || near(abc.rows.at(-1).cumShare, 1, 0.0001)) && abc.rows.every((r, i) => i === 0 || r.class >= abc.rows[i - 1].class),
    abc.rows.map((r) => `${r.class} ${r.cumShare}`)
  );
  check("ABC: trae la existencia actual", abc.rows.every((r) => r.stock !== null), abc.rows[0]);

  const margin = await preview("MARGIN_PRODUCTS");
  check("margen por producto: de peor a mejor, margen = venta − costo", margin.rows.every((r, i) => near(r.margin, r.net - r.cost) && (i === 0 || r.marginPct >= margin.rows[i - 1].marginPct)), margin.rows.slice(0, 3));
  check(
    "estado según el margen (pérdida, bajo 20 %, normal)",
    margin.rows.every((r) => r.status === (r.marginPct < 0 ? "Pérdida" : r.marginPct < 0.2 ? "Bajo" : "Normal")) && kpi(margin, "loss")?.value === margin.rows.filter((r) => r.status === "Pérdida").length,
    margin.summary.kpis
  );

  section("Caja");
  const pay = await preview("PAYMENTS");
  check("cobros por medio de pago y moneda, con el vuelto en negativo", pay.total > 0 && pay.rows.every((r) => (r.method === "Vuelto entregado") === (r.amountBase < 0)), pay.rows);
  check("cobrado neto = suma del detalle", near(kpi(pay, "collected")?.value, total(pay.rows, "amountBase")), kpi(pay, "collected"));
  check("participaciones de los cobros suman 100 %", near(total(pay.rows.filter((r) => r.share !== null), "share"), 1, 0.001), pay.rows.map((r) => r.share));
  check("cobros en divisas y gráfico por medio de pago", kpi(pay, "foreign")?.value > 0 && pay.summary.charts.some((c) => c.kind === "donut"), kpi(pay, "foreign"));

  const counts = await preview("CASH_COUNTS");
  check("arqueos de los turnos cerrados", counts.total > 0 && kpi(counts, "sessions")?.value >= 1, counts.rows.slice(0, 2));
  check("diferencia neta = sobrantes − faltantes", near(kpi(counts, "net")?.value, kpi(counts, "over")?.value - kpi(counts, "short")?.value), counts.summary.kpis);

  section("Inventario");
  const repl = await preview("REPLENISHMENT");
  check(
    "reposición: solo lo que no alcanza su punto de pedido, con cantidad sugerida",
    repl.rows.every((r) => r.suggested > 0 && r.available + r.onOrder <= r.reorderPoint + 1e-6 && ["Comprar", "Fabricar"].includes(r.action)),
    repl.rows.slice(0, 3)
  );
  check("reposición: costo estimado = sugerida × costo", repl.rows.every((r) => near(r.estimated, r.suggested * r.avgCost, 0.05)) && kpi(repl, "items")?.value === repl.total, kpi(repl, "items"));

  const risk = await preview("STOCKOUT_RISK");
  check("riesgo de quiebre: cobertura de 14 días o menos, ordenado por urgencia", risk.rows.every((r, i) => r.coverDays <= 14 && (i === 0 || r.coverDays >= risk.rows[i - 1].coverDays)), risk.rows.slice(0, 3));
  check("riesgo de quiebre: los agotados están marcados", risk.rows.every((r) => (r.risk === "Agotado") === (r.coverDays <= 0)));

  const slow = await preview("SLOW_MOVERS", `?from=${today()}&to=${today()}`);
  check("sin movimiento: existencias sin salida en el rango, con su valor", slow.rows.every((r) => r.quantity > 0 && near(r.value, r.quantity * r.avgCost, 0.05)) && kpi(slow, "share")?.value <= 1, slow.rows.slice(0, 2));

  section("Excel con resumen");
  const xlsx = await download(admin, "/dashboard/reports/SALES_DAILY/xlsx");
  check(
    "el Excel trae la hoja de resumen y la de detalle",
    xlsx.status === 200 && xlsx.buf.subarray(0, 2).toString() === "PK" && xlsx.buf.includes("xl/worksheets/sheet2.xml"),
    { status: xlsx.status }
  );
  const plain = await download(admin, "/dashboard/reports/MRP/xlsx");
  check("un reporte sin gráficos igual lleva su resumen de indicadores", plain.status === 200 && plain.buf.includes("xl/worksheets/sheet2.xml"), { status: plain.status });
}
