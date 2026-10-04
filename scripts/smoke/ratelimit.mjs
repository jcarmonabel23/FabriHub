/**
 * @project FabriHub
 * @file scripts/smoke/ratelimit.mjs
 * @description Límite de intentos por IP. Va SIEMPRE al final: deja la IP bloqueada 15 minutos.
 */

import { call, check, section } from "./_client.mjs";

export async function run() {
  section("Límite por IP (deja la IP bloqueada 15 min)");
  let limited;
  for (let i = 0; i < 120 && !limited; i++) {
    const r = await call("POST", "/auth/sign-in", { body: { email: `spray${i}@fabrihub.local`, password: "x" } });
    if (r.status === 429) limited = r;
  }
  check("rociado de contraseñas desde una IP → 429 RATE_LIMITED", limited?.code === "RATE_LIMITED", limited?.json);
}
