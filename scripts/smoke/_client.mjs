/**
 * @project FabriHub
 * @file scripts/smoke/_client.mjs
 * @description Utilidades compartidas por las suites de humo: llamadas a la API, correo (mailpit) y conteo
 */

export const API = process.env.API_URL ?? "http://api:4000/api/v1";
export const MAIL = process.env.MAILPIT_URL ?? "http://mailpit:8025/api/v1";
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
export const ADMIN_INITIAL = process.env.ADMIN_INITIAL_PASSWORD;
export const ADMIN_NEW = "Fabri.Hub-2026!x";

export const results = { passed: 0, failed: 0 };

export function section(title) {
  console.log(`\n● ${title}`);
}

export function check(name, condition, extra) {
  if (condition) {
    results.passed++;
    console.log(`  ✔ ${name}`);
  } else {
    results.failed++;
    console.log(`  ✘ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(method, path, { token, body, cookie } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  const setCookie = res.headers.get("set-cookie");
  const refresh = setCookie?.match(/fh_refresh=([^;]*)/)?.[1];
  return { status: res.status, json, code: json?.error?.code, cookie: refresh ? `fh_refresh=${refresh}` : undefined };
}

export async function lastMailText(to) {
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
    const data = await res.json();
    const id = data.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`${MAIL}/message/${id}`)).json();
      return msg.Text || msg.HTML;
    }
    await sleep(300);
  }
  throw new Error(`No llegó correo a ${to}`);
}

export const otpFrom = (text) => text.match(/\b(\d{6})\b/)?.[1];

/** Login completo (contraseña + OTP leído del correo) */
export async function login(email, password) {
  const step1 = await call("POST", "/auth/sign-in", { body: { email, password } });
  if (step1.status !== 200) return { step1 };
  const code = otpFrom(await lastMailText(email));
  const step2 = await call("POST", "/auth/otp/verify", { body: { challengeId: step1.json.challengeId, code } });
  return { step1, step2, token: step2.json?.accessToken, cookie: step2.cookie };
}

/** Crea un usuario, le asigna módulos y lo deja listo para usar (contraseña ya cambiada) */
export async function createUserWith(adminToken, email, names, assignments, newPassword = "Prueba#Segura2026") {
  const created = await call("POST", "/admin/users", { token: adminToken, body: { email, names } });
  const temp = (await lastMailText(email)).match(/asignó una contraseña temporal:\s*(\S+)/)?.[1];
  await call("PUT", `/admin/users/${created.json.id}/modules`, { token: adminToken, body: { assignments } });
  const s = await login(email, temp);
  await call("POST", "/auth/change-password", { token: s.token, body: { currentPassword: temp, newPassword } });
  return { id: created.json.id, token: s.token };
}

let adminToken = null;

/**
 * Sesión de administrador sin importar si ya cambió la contraseña inicial. Se reutiliza entre
 * suites: cada login cuenta para el límite por IP (AUTH_RATE_LIMIT) y el script corre desde una sola IP.
 */
export async function adminSession() {
  if (adminToken && (await call("GET", "/auth/me", { token: adminToken })).status === 200) return adminToken;
  let s = await login(ADMIN_EMAIL, ADMIN_NEW);
  if (!s.token) {
    s = await login(ADMIN_EMAIL, ADMIN_INITIAL);
    await call("POST", "/auth/change-password", {
      token: s.token,
      body: { currentPassword: ADMIN_INITIAL, newPassword: ADMIN_NEW }
    });
  }
  adminToken = s.token;
  return s.token;
}
