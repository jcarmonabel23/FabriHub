/**
 * @project FabriHub - API
 * @file src/modules/einvoice/hacienda.ts
 * @description Cliente de Hacienda: token OAuth del IdP y API de recepción (envío y consulta de estado)
 *
 * @overview
 * El IdP entrega un token con el usuario y la clave del ATV (grant «password»); se guarda en memoria
 * hasta poco antes de vencer. La recepción acepta el comprobante (202) y lo valida después:
 * su estado se consulta por la clave hasta que sea «aceptado» o «rechazado».
 * Fuera de producción la empresa puede apuntar a un Hacienda simulado (pruebas de humo).
 */

export type Environment = "sandbox" | "prod";

export const ENDPOINTS: Record<Environment, { idp: string; clientId: string; api: string }> = {
  sandbox: {
    idp: "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token",
    clientId: "api-stag",
    api: "https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1"
  },
  prod: {
    idp: "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token",
    clientId: "api-prod",
    api: "https://api.comprobanteselectronicos.go.cr/recepcion/v1"
  }
};

export interface Target {
  environment: Environment;
  idpUrl: string;
  apiUrl: string;
  clientId: string;
}

/** Error de comunicación con Hacienda; `retry` = vale la pena reintentar más tarde */
export class HaciendaError extends Error {
  constructor(
    message: string,
    readonly retry = true
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 30_000;

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
    throw new HaciendaError(`Sin conexión con Hacienda (${cause})`);
  }
}

// ------------------------------------------------------------------ Token

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Token de acceso (en caché por empresa, ambiente y usuario) */
export async function accessToken(companyId: string, target: Target, username: string, password: string): Promise<string> {
  const cacheKey = `${companyId}|${target.idpUrl}|${username}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const res = await call(target.idpUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: target.clientId, username, password }).toString()
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !body?.access_token) {
    // 400/401: usuario o clave del ATV inválidos; no se reintenta hasta que los corrijan
    const auth = res.status === 400 || res.status === 401;
    throw new HaciendaError(
      auth ? `Hacienda rechazó el usuario del ATV: ${body?.error_description ?? "credenciales inválidas"}` : `El IdP de Hacienda respondió ${res.status}`,
      !auth
    );
  }
  tokens.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + Math.max(30, (body.expires_in ?? 300) - 30) * 1000 });
  return body.access_token;
}

/** Olvida los tokens de una empresa (cambiaron sus credenciales) */
export function forgetTokens(companyId: string): void {
  for (const k of tokens.keys()) if (k.startsWith(`${companyId}|`)) tokens.delete(k);
}

// ------------------------------------------------------------------ Recepción

export interface Submission {
  clave: string;
  fecha: string;
  emisor: { tipoIdentificacion: string; numeroIdentificacion: string };
  receptor?: { tipoIdentificacion: string; numeroIdentificacion: string };
  comprobanteXml: string;
}

/** Envía el comprobante. Devuelve «received» o, si Hacienda ya lo tenía, «duplicate» */
export async function submit(target: Target, token: string, s: Submission): Promise<"received" | "duplicate"> {
  const res = await call(`${target.apiUrl}/recepcion`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(s)
  });
  if (res.status === 201 || res.status === 202 || res.status === 200) return "received";
  const cause = res.headers.get("x-error-cause") ?? (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 400 && /ya (fue|ha sido) recibid|duplicad/i.test(cause)) return "duplicate";
  if (res.status === 401 || res.status === 403) {
    tokens.clear();
    throw new HaciendaError(`Hacienda no autorizó el envío (${res.status})`);
  }
  // 4xx: el envío tiene un problema que reintentar no resuelve (se reintenta igual, más espaciado)
  throw new HaciendaError(`Hacienda rechazó el envío (${res.status}): ${cause || "sin detalle"}`, res.status >= 500);
}

export interface Status {
  state: "received" | "processing" | "accepted" | "rejected" | "error" | "unknown";
  responseXml: string | null;
}

/** Estado del comprobante en Hacienda */
export async function status(target: Target, token: string, clave: string): Promise<Status> {
  const res = await call(`${target.apiUrl}/recepcion/${clave}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return { state: "unknown", responseXml: null };
  if (res.status === 401 || res.status === 403) {
    tokens.clear();
    throw new HaciendaError(`Hacienda no autorizó la consulta (${res.status})`);
  }
  if (!res.ok) throw new HaciendaError(`Hacienda respondió ${res.status} al consultar el estado`);
  const body = (await res.json().catch(() => ({}))) as { "ind-estado"?: string; "respuesta-xml"?: string };
  const state = (body["ind-estado"] ?? "").toLowerCase();
  const map: Record<string, Status["state"]> = { recibido: "received", procesando: "processing", aceptado: "accepted", rechazado: "rejected", error: "error" };
  return {
    state: map[state] ?? "unknown",
    responseXml: body["respuesta-xml"] ? Buffer.from(body["respuesta-xml"], "base64").toString("utf8") : null
  };
}
