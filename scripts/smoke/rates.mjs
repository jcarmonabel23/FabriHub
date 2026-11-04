/**
 * @project FabriHub
 * @file scripts/smoke/rates.mjs
 * @description Fase 16: tipos de cambio automáticos. BCV (Venezuela) y BCCR (Costa Rica) se
 * simulan con un servidor HTTP dentro del contenedor de pruebas (alias de red «smoke-runner»,
 * ver scripts/smoke.sh); la API acepta esa URL solo fuera de producción.
 *
 * No abre sesiones nuevas: usa la del administrador y la empresa de Costa Rica de la suite de países.
 */

import http from "node:http";
import { adminSession, call, check, section } from "./_client.mjs";

const PORT = 18999;
const MOCK = `http://smoke-runner:${PORT}`;
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.prueba-de-humo-del-bccr.firma";

/** Lo que responde el servidor simulado (las pruebas lo cambian) */
const mock = { usd: "40,50000000", eur: "44,25000000", sell: 512.34, buy: 505.1, bccrHits: [] };

const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const bcvPage = () => `<html><body>
<div id="euro" class="col-sm-12"><div class="field-content"><span> EUR </span><strong class="strong-tb"> ${mock.eur}</strong></div></div>
<div id="yuan" class="col-sm-12"><div class="field-content"><span> CNY </span><strong class="strong-tb"> 5,40000000</strong></div></div>
<div id="dolar" class="col-sm-12"><div class="field-content"><span> USD</span><strong class="strong-tb">${mock.usd}</strong></div>
<div class="pull-right dinpro center"> Fecha Valor: <span class="date-display-single" property="dc:date" content="${todayIn("America/Caracas")}T00:00:00-04:00">hoy</span></div></div>
</body></html>`;

function startMock() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, MOCK);
    if (url.pathname === "/bcv") return res.end(bcvPage());
    if (url.pathname === "/bcv-roto") return res.end("<html>mantenimiento</html>");
    const m = /^\/bccr\/indicadoresEconomicos\/(\d+)\/series$/.exec(url.pathname);
    if (m) {
      mock.bccrHits.push({ indicator: m[1], auth: req.headers.authorization, from: url.searchParams.get("fechainicio") });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ mensaje: "No autorizado" }));
      }
      const today = todayIn("America/Costa_Rica");
      const value = m[1] === "333" ? 1.08 : m[1] === "318" ? mock.sell : mock.buy;
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify({
          estado: true,
          datos: [{ codigoIndicador: m[1], nombreIndicador: "Tipo de cambio", series: [{ fecha: `${today}T00:00:00`, valorDatoPorPeriodo: value }] }]
        })
      );
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(PORT, "0.0.0.0", () => resolve(server)));
}

export async function run() {
  const admin = await adminSession();
  const server = await startMock();
  const runRates = (sourceUrl) => call("POST", "/settings/exchange-rates/run", { token: admin, body: { sourceUrl } });
  const params = async () => (await call("GET", "/settings/parameters", { token: admin })).json;
  const setParam = async (key, value) => {
    const p = (await params()).find((x) => x.moduleCode === "SETTINGS" && x.key === key);
    return call("PATCH", `/settings/parameters/${p.id}`, { token: admin, body: { value } });
  };
  const me = await call("GET", "/auth/me", { token: admin });
  const companyVE = me.json.company;

  try {
    section("Venezuela · BCV");
    const st = (await call("GET", "/settings/exchange-rates", { token: admin })).json;
    check("fuente BCV, sin token, automática apagada de fábrica", st?.provider?.code === "BCV" && st.token === null && st.autoEnabled === false, st);
    const p = await params();
    check("parámetros de tasas (sin el del BCCR en Venezuela)", p.some((x) => x.key === "rates_auto_enabled") && !p.some((x) => x.key === "rates_bccr_side"));

    const currencies = (await call("GET", "/settings/catalogs/currencies", { token: admin })).json;
    const usd = currencies.find((c) => c.code === "USD");
    const eur = currencies.find((c) => c.code === "EUR");
    const eurRates = async () => (await call("GET", `/settings/currencies/${eur.id}/rates`, { token: admin })).json;

    const r1 = await runRates(`${MOCK}/bcv`);
    const act = (r, cur) => r.json?.rates?.find((x) => x.currency === cur)?.action;
    check("consulta al BCV: correcta y con la fecha valor de hoy", r1.json?.status === "ok" && r1.json?.rates?.every((x) => x.rateDate === todayIn("America/Caracas")), r1.json);
    check("el dólar cargado a mano hoy se mantiene", act(r1, "USD") === "kept_manual", r1.json?.rates);
    // El punto de venta (módulo anterior) ya dejó la referencial del euro: la oficial la reemplaza
    check("el euro se registra (44,25 Bs.) y reemplaza la referencial", ["inserted", "updated"].includes(act(r1, "EUR")) && r1.json.rates.find((x) => x.currency === "EUR").rate === 44.25, r1.json?.rates);
    check("monedas fuera del catálogo (yuan) se ignoran", !r1.json?.rates?.some((x) => x.currency === "CNY"));
    const e1 = (await eurRates())[0];
    check("la tasa queda marcada como automática, fuente BCV", e1?.isAutomatic === true && e1?.source === "BCV" && e1?.valueDate === todayIn("America/Caracas"), e1);
    const usdToday = (await call("GET", `/settings/currencies/${usd.id}/rates`, { token: admin })).json.find((x) => x.rateDate === todayIn("America/Caracas"));
    check("el dólar sigue en 36,75 (manual)", usdToday?.rate === 36.75 && usdToday?.isAutomatic === false, usdToday);

    const r2 = await runRates(`${MOCK}/bcv`);
    check("otra consulta sin cambios no reescribe", act(r2, "EUR") === "unchanged", r2.json?.rates);
    mock.eur = "45,00000000";
    const r3 = await runRates(`${MOCK}/bcv`);
    check("si la fuente corrige el valor, la automática se actualiza", act(r3, "EUR") === "updated" && (await eurRates())[0]?.rate === 45, r3.json?.rates);
    await call("POST", `/settings/currencies/${eur.id}/rates`, { token: admin, body: { rateDate: todayIn("America/Caracas"), rate: 46 } });
    const e2 = (await eurRates())[0];
    check("corregirla a mano la vuelve manual", e2?.rate === 46 && e2?.isAutomatic === false, e2);
    mock.eur = "47,00000000";
    const r4 = await runRates(`${MOCK}/bcv`);
    check("y la consulta ya no la reemplaza", act(r4, "EUR") === "kept_manual" && (await eurRates())[0]?.rate === 46, r4.json?.rates);

    const card = (await call("GET", "/dashboard/exchange-rates", { token: admin })).json;
    const cardOf = (c) => card?.rates?.find((x) => x.code === c);
    check("tarjeta del tablero: bolívares por dólar y por euro, fuente BCV", card?.local?.code === "VES" && card?.provider?.code === "BCV" && card.rates?.length === 2, card);
    check("tarjeta: dólar 36,75 y euro 46 vigentes hoy, marcados como manuales", cardOf("USD")?.rate === 36.75 && cardOf("EUR")?.rate === 46 && cardOf("USD")?.official === false && cardOf("EUR")?.rateDate === todayIn("America/Caracas"), card?.rates);
    check("tarjeta: con la tasa del día no lanza otra consulta", card?.refreshing === false, card);

    const broken = await runRates(`${MOCK}/bcv-roto`);
    check("página del BCV irreconocible → consulta fallida con el motivo", broken.json?.status === "error" && /fecha valor/.test(broken.json?.message ?? ""), broken.json);
    const st2 = (await call("GET", "/settings/exchange-rates", { token: admin })).json;
    check("la bitácora guarda las consultas (la última primero)", st2?.runs?.length === 5 && st2.runs[0].status === "error" && st2.runs[0].trigger === "manual", st2?.runs?.length);

    await setParam("rates_auto_enabled", true);
    await call("POST", "/dashboard/alerts/run", { token: admin });
    const alerts = (await call("GET", "/dashboard/alerts?status=open&pageSize=200", { token: admin })).json;
    check("alerta RATES_FAILED si la última consulta falló (automática activa)", alerts.items?.some((a) => a.kind === "RATES_FAILED"), alerts.items?.map((a) => a.kind));
    await runRates(`${MOCK}/bcv`);
    await call("POST", "/dashboard/alerts/run", { token: admin });
    const after = (await call("GET", "/dashboard/alerts?status=open&pageSize=200", { token: admin })).json;
    check("una consulta correcta la resuelve", !after.items?.some((a) => a.kind === "RATES_FAILED"), after.items?.map((a) => a.kind));
    await setParam("rates_auto_enabled", false);

    const tokenVE = await call("PUT", "/settings/exchange-rates/token", { token: admin, body: { token: TOKEN } });
    check("el BCV no usa token → 400", tokenVE.code === "TOKEN_NOT_NEEDED", tokenVE.json);

    section("Costa Rica · BCCR");
    const list = (await call("GET", "/admin/companies", { token: admin })).json;
    const cr = list.find((c) => c.countryCode === "CR");
    await call("POST", "/auth/switch-company", { token: admin, body: { companyId: cr.id } });
    try {
      const s1 = (await call("GET", "/settings/exchange-rates", { token: admin })).json;
      check("fuente BCCR, pide token y aún no lo tiene", s1?.provider?.code === "BCCR" && s1.provider.needsToken && s1.token?.configured === false, s1);
      check("parámetro compra/venta visible en Costa Rica", (await params()).some((x) => x.key === "rates_bccr_side"));
      const noToken = await runRates(`${MOCK}/bccr`);
      check("sin token → consulta fallida que lo explica", noToken.json?.status === "error" && /token/i.test(noToken.json?.message ?? "") && mock.bccrHits.length === 0, noToken.json);
      // Sin tasa vigente queda la referencial del país (la registra esta consulta o, antes, el tablero o la caja)
      const cardRef = (await call("GET", "/dashboard/exchange-rates", { token: admin })).json;
      const refCard = (c) => cardRef?.rates?.find((x) => x.code === c);
      check(
        "sin token ni tasa: referencial del país (₡505 por dólar, ₡585 por euro), marcada como tal",
        refCard("USD")?.rate === 505 && refCard("EUR")?.rate === 585 && refCard("USD")?.reference === true && refCard("USD")?.official === false && cardRef?.refreshing === false,
        cardRef
      );
      const posMe = (await call("GET", "/pos/me", { token: admin })).json;
      check("punto de venta: el dólar y el euro se pueden cobrar con la referencial", ["USD", "EUR"].every((c) => posMe?.currencies?.some((x) => x.code.trim() === c && x.rate > 0)), posMe?.currencies);

      const short = await call("PUT", "/settings/exchange-rates/token", { token: admin, body: { token: "corto" } });
      check("token demasiado corto → 400", short.status === 400, short.json);
      const saved = await call("PUT", "/settings/exchange-rates/token", { token: admin, body: { token: `Bearer ${TOKEN}` } });
      check("guarda el token (sin «Bearer») y muestra solo el final", saved.json?.configured && saved.json?.hint === `…${TOKEN.slice(-6)}`, saved.json);
      const s2 = await call("GET", "/settings/exchange-rates", { token: admin });
      check("el token nunca vuelve en las respuestas", s2.json?.token?.configured && !JSON.stringify(s2.json).includes(TOKEN), s2.json?.token);

      const ok = await runRates(`${MOCK}/bccr`);
      const hit = mock.bccrHits.find((h) => h.indicator !== "333");
      check("consulta al BCCR con el token como Bearer e indicador 318 (venta)", hit?.auth === `Bearer ${TOKEN}` && hit?.indicator === "318", hit);
      const usdCr = ok.json?.rates?.find((x) => x.currency === "USD");
      const eurCr = ok.json?.rates?.find((x) => x.currency === "EUR");
      const cardCr = (await call("GET", "/dashboard/exchange-rates", { token: admin })).json;
      const crOf = (c) => cardCr?.rates?.find((x) => x.code === c);
      check("tarjeta en Costa Rica: colones por dólar y por euro, fuente BCCR, oficiales", cardCr?.local?.code === "CRC" && cardCr?.provider?.code === "BCCR" && crOf("USD")?.rate === 512.34 && crOf("EUR")?.rate === 553.3272 && crOf("USD")?.official === true, cardCr);
      check("euro en colones = indicador 333 (dólares por euro) × dólar", mock.bccrHits.at(-1)?.indicator === "333" && eurCr?.rate === Number((1.08 * 512.34).toFixed(8)), ok.json?.rates);
      check("tipo de cambio en colones registrado: reemplaza la referencial del día", ok.json?.status === "ok" && usdCr?.rate === 512.34 && usdCr?.action === "updated", ok.json);

      await setParam("rates_bccr_side", "buy");
      const buy = await runRates(`${MOCK}/bccr`);
      check("con «compra» usa el indicador 317", mock.bccrHits.at(-2)?.indicator === "317" && buy.json?.rates?.find((x) => x.currency === "USD")?.rate === 505.1, buy.json?.rates);
      await setParam("rates_bccr_side", "sell");

      await call("PUT", "/settings/exchange-rates/token", { token: admin, body: { token: "otro-token-que-el-bccr-no-reconoce-123" } });
      const rejected = await runRates(`${MOCK}/bccr`);
      check("token rechazado (401) → mensaje claro", rejected.json?.status === "error" && /rechazó el token/.test(rejected.json?.message ?? ""), rejected.json);
      await call("DELETE", "/settings/exchange-rates/token", { token: admin });
      const s3 = (await call("GET", "/settings/exchange-rates", { token: admin })).json;
      check("quitar el token", s3?.token?.configured === false, s3?.token);
    } finally {
      await call("POST", "/auth/switch-company", { token: admin, body: { companyId: companyVE.id } });
    }
  } finally {
    await setParam("rates_auto_enabled", false).catch(() => undefined);
    server.close();
  }
}
