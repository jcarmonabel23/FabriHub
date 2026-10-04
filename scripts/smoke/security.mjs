/**
 * @project FabriHub
 * @file scripts/smoke/security.mjs
 * @description Suite de humo de la fase 1 (seguridad). Requiere BD recién creada: usa la contraseña inicial del admin.
 */

import { ADMIN_EMAIL, ADMIN_INITIAL, ADMIN_NEW, API, call, check, lastMailText, login, otpFrom, sleep } from "./_client.mjs";

const USER_EMAIL = `almacen.${Date.now()}@fabrihub.local`;
const USER_NEW = "Almacen#Segura2026";

export async function run() {
  console.log("\n● Identidad y segundo factor");
  const health = await fetch(API.replace("/api/v1", "/health"));
  check("health responde ok", health.status === 200);

  const bad = await call("POST", "/auth/sign-in", { body: { email: ADMIN_EMAIL, password: "incorrecta" } });
  const unknown = await call("POST", "/auth/sign-in", { body: { email: "nadie@fabrihub.local", password: "x" } });
  check("contraseña errada → 401 INVALID_CREDENTIALS", bad.status === 401 && bad.code === "INVALID_CREDENTIALS", bad);
  check("correo inexistente responde igual (sin enumeración)", unknown.status === 401 && unknown.code === bad.code);

  const s1 = await call("POST", "/auth/sign-in", { body: { email: ADMIN_EMAIL, password: ADMIN_INITIAL } });
  check("contraseña correcta → desafío OTP (sin sesión aún)", s1.status === 200 && s1.json.challengeId && !s1.cookie, s1.json);
  const realCode = otpFrom(await lastMailText(ADMIN_EMAIL));
  check("el OTP llega por correo", /^\d{6}$/.test(realCode ?? ""));
  const wrongCode = realCode === "000000" ? "111111" : "000000";
  const badOtp = await call("POST", "/auth/otp/verify", { body: { challengeId: s1.json.challengeId, code: wrongCode } });
  check("OTP errado → OTP_INVALID con intentos restantes", badOtp.code === "OTP_INVALID", badOtp.json);
  const okOtp = await call("POST", "/auth/otp/verify", { body: { challengeId: s1.json.challengeId, code: realCode } });
  check("OTP correcto → access token + cookie refresh", okOtp.status === 200 && okOtp.json.accessToken && okOtp.cookie, okOtp.json);
  const replay = await call("POST", "/auth/otp/verify", { body: { challengeId: s1.json.challengeId, code: realCode } });
  check("el OTP no se puede reutilizar", replay.code === "OTP_EXPIRED", replay.json);

  let adminToken = okOtp.json.accessToken;

  console.log("\n● Cambio obligatorio de contraseña");
  const blocked = await call("GET", "/admin/users", { token: adminToken });
  check("con cambio pendiente la API bloquea los módulos", blocked.status === 403 && blocked.code === "PASSWORD_CHANGE_REQUIRED", blocked.json);
  const weak = await call("POST", "/auth/change-password", {
    token: adminToken,
    body: { currentPassword: ADMIN_INITIAL, newPassword: "corta" }
  });
  check("política de contraseñas → PASSWORD_POLICY", weak.code === "PASSWORD_POLICY", weak.json);
  const changed = await call("POST", "/auth/change-password", {
    token: adminToken,
    body: { currentPassword: ADMIN_INITIAL, newPassword: ADMIN_NEW }
  });
  check("cambio válido aceptado", changed.status === 200 && changed.json.user.mustChangePassword === false, changed.json);

  const me = await call("GET", "/auth/me", { token: adminToken });
  const adm = me.json?.modules?.find((m) => m.code === "ADM_USERS");
  check("/me trae módulos con permisos efectivos", adm?.permissions?.includes("configure"), adm);
  const visit = await call("POST", "/metrics/visit", { token: adminToken, body: { moduleCode: "ADM_USERS", path: "/admin/users" } });
  check("registro de visita a módulo", visit.status === 204, visit.json);
  const offline = me.json?.modules?.find((m) => m.code === "PRD_PLANNING");
  check("módulos de fases futuras llegan como fuera de servicio", offline?.isOffline === true);

  console.log("\n● Administración de usuarios y RBAC");
  const list = await call("GET", "/admin/users", { token: adminToken });
  check("admin lista usuarios", list.status === 200 && list.json.total >= 1, list.json);
  const created = await call("POST", "/admin/users", {
    token: adminToken,
    body: { email: USER_EMAIL, names: "Ana Almacén" }
  });
  check("alta de usuario → 201", created.status === 201 && created.json.mustChangePassword === true, created.json);
  const userId = created.json.id;
  const tempPwd = (await lastMailText(USER_EMAIL)).match(/asignó una contraseña temporal:\s*(\S+)/)?.[1];
  check("la contraseña temporal llega por correo", Boolean(tempPwd));

  const lookups = await call("GET", "/admin/users/lookups", { token: adminToken });
  const viewer = lookups.json.roles.find((r) => r.slug === "viewer");
  const assigned = await call("PUT", `/admin/users/${userId}/modules`, {
    token: adminToken,
    body: { assignments: [{ moduleCode: "ADM_AUDIT", roleIds: [viewer.id], permissions: [] }] }
  });
  check("asignación de módulo con rol", assigned.status === 200 && assigned.json.assignments.length === 1, assigned.json);
  const badAssign = await call("PUT", `/admin/users/${userId}/modules`, {
    token: adminToken,
    body: { assignments: [{ moduleCode: "ADMIN", roleIds: [viewer.id] }] }
  });
  check("un módulo raíz no es asignable", badAssign.code === "INVALID_MODULE", badAssign.json);

  const u = await login(USER_EMAIL, tempPwd);
  check("usuario nuevo inicia sesión con OTP", Boolean(u.token), u.step1?.json ?? u.step2?.json);
  await call("POST", "/auth/change-password", { token: u.token, body: { currentPassword: tempPwd, newPassword: USER_NEW } });
  const reuse = await call("POST", "/auth/change-password", {
    token: u.token,
    body: { currentPassword: USER_NEW, newPassword: tempPwd }
  });
  check("no puede reutilizar una contraseña anterior", reuse.code === "PASSWORD_REUSED", reuse.json);
  const auditOk = await call("GET", "/admin/audit/auth", { token: u.token });
  check("con rol Consulta en Auditoría puede ver la bitácora", auditOk.status === 200, auditOk.json);
  const usersDenied = await call("GET", "/admin/users", { token: u.token });
  check("sin asignación en Usuarios → 403", usersDenied.status === 403 && usersDenied.code === "FORBIDDEN", usersDenied.json);
  const tablesDenied = await call("POST", "/admin/roles", {
    token: u.token,
    body: { slug: "hack", name: "Hack", permissions: ["access"] }
  });
  check("no puede crear roles (403 en el servidor, no solo oculto)", tablesDenied.status === 403);

  console.log("\n● Anti-bloqueo del administrador");
  const self = await call("PATCH", `/admin/users/${me.json.user.id}`, { token: adminToken, body: { isActive: false } });
  check("no puede desactivarse a sí mismo", self.code === "SELF_LOCKOUT", self.json);
  const selfMods = await call("PUT", `/admin/users/${me.json.user.id}/modules`, { token: adminToken, body: { assignments: [] } });
  check("no puede quitarse Usuarios/configurar", selfMods.code === "SELF_LOCKOUT", selfMods.json);
  const roles = await call("GET", "/admin/roles", { token: adminToken });
  const adminRole = roles.json.find((r) => r.slug === "admin");
  const lockRole = await call("PATCH", `/admin/roles/${adminRole.id}`, { token: adminToken, body: { permissions: ["access"] } });
  check("el rol Administrador no pierde permisos", lockRole.code === "ADMIN_ROLE_LOCKED", lockRole.json);
  const mods = await call("GET", "/admin/modules", { token: adminToken });
  const admMod = mods.json.find((m) => m.code === "ADM_USERS");
  const offAdm = await call("PATCH", `/admin/modules/${admMod.id}`, { token: adminToken, body: { isOffline: true } });
  check("Seguridad no se puede apagar", offAdm.code === "PROTECTED_MODULE", offAdm.json);

  console.log("\n● Fuerza bruta");
  let last;
  for (let i = 0; i < 5; i++) {
    last = await call("POST", "/auth/sign-in", { body: { email: USER_EMAIL, password: `Mala${i}` } });
  }
  const locked = await call("POST", "/auth/sign-in", { body: { email: USER_EMAIL, password: USER_NEW } });
  check("5 fallos bloquean la cuenta (aun con la clave correcta)", locked.status === 423 && locked.code === "ACCOUNT_LOCKED", { last: last.json, locked: locked.json });
  const unlock = await call("POST", `/admin/users/${userId}/unlock`, { token: adminToken });
  check("admin desbloquea", unlock.status === 200 && unlock.json.lockedUntil === null, unlock.json);
  const again = await login(USER_EMAIL, USER_NEW);
  check("tras desbloqueo vuelve a entrar", Boolean(again.token));

  console.log("\n● Sesión: rotación, reuso y revocación");
  const r1 = await call("POST", "/auth/refresh", { cookie: again.cookie });
  check("refresh rota el token", r1.status === 200 && r1.cookie && r1.cookie !== again.cookie, r1.json);
  const race = await call("POST", "/auth/refresh", { cookie: again.cookie });
  check("refresh viejo segundos después → 409 carrera (no castiga)", race.status === 409 && race.code === "REFRESH_RACE", race.json);
  console.log("    (esperando 16 s para simular robo del refresh viejo…)");
  await sleep(16_000);
  const stolen = await call("POST", "/auth/refresh", { cookie: again.cookie });
  check("refresh viejo reutilizado → REFRESH_REUSED", stolen.code === "REFRESH_REUSED", stolen.json);
  const afterTheft = await call("GET", "/auth/me", { token: r1.json.accessToken });
  check("tras el reuso todas las sesiones quedan revocadas al instante", afterTheft.code === "SESSION_REVOKED", afterTheft.json);

  const deact = await login(USER_EMAIL, USER_NEW);
  await call("PATCH", `/admin/users/${userId}`, { token: adminToken, body: { isActive: false } });
  const afterDeact = await call("GET", "/admin/audit/auth", { token: deact.token });
  check("desactivar al usuario corta su sesión al instante", afterDeact.status === 401, afterDeact.json);

  const out = await call("POST", "/auth/logout", { cookie: changed.cookie ?? okOtp.cookie });
  check("logout → 204", out.status === 204);
  const afterLogout = await call("GET", "/auth/me", { token: adminToken });
  check("tras logout el access token deja de servir", afterLogout.status === 401, afterLogout.json);

  console.log("\n● Auditoría");
  const admin2 = await login(ADMIN_EMAIL, ADMIN_NEW);
  check("admin vuelve a entrar con su nueva contraseña", Boolean(admin2.token), admin2.step1?.json);
  const audit = await call("GET", "/admin/audit/data?table=users_modules", { token: admin2.token });
  const row = audit.json?.items?.[0];
  check("los cambios quedan auditados con el usuario que los hizo", row?.userEmail === ADMIN_EMAIL, row);
  const pwdLeak = await call("GET", "/admin/audit/data?table=users", { token: admin2.token });
  check("la auditoría nunca guarda el hash de contraseña", !JSON.stringify(pwdLeak.json).includes("password_hash"));
  const authLog = await call("GET", "/admin/audit/auth?event=refresh_reuse", { token: admin2.token });
  check("el robo de refresh quedó en la bitácora de accesos", authLog.json?.total >= 1, authLog.json);
}
