/**
 * @project FabriHub
 * @file scripts/smoke/index.mjs
 * @description Ejecuta las suites de humo en orden. La de límite por IP siempre al final.
 */

import { results } from "./_client.mjs";
import * as security from "./security.mjs";
import * as settingsTaxes from "./settings-taxes.mjs";
import * as inventory from "./inventory.mjs";
import * as purchases from "./purchases.mjs";
import * as production from "./production.mjs";
import * as sales from "./sales.mjs";
import * as ratelimit from "./ratelimit.mjs";

const SUITES = [
  ["Fase 1 · Seguridad", security],
  ["Fase 2 · Parámetros e Impuestos", settingsTaxes],
  ["Fase 3 · Inventario", inventory],
  ["Fase 4 · Compras y Calidad", purchases],
  ["Fase 5 · Producción", production],
  ["Fase 6 · Ventas", sales],
  ["Límite por IP", ratelimit]
];

try {
  for (const [name, suite] of SUITES) {
    console.log(`\n════════ ${name}`);
    await suite.run();
  }
} catch (err) {
  console.error(err);
  results.failed++;
}

console.log(`\n${results.passed} correctas, ${results.failed} fallidas\n`);
process.exit(results.failed ? 1 : 0);
