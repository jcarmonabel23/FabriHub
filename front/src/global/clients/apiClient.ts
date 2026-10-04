/**
 * @project FabriHub - Front
 * @file src/global/clients/apiClient.ts
 * @description Cliente HTTP único hacia /api/v1 (equivalente al apiProxyClient de DaviHub)
 *
 * @overview
 * - Inyecta `Authorization: Bearer` y un `x-trace-id` por petición (el mismo id que queda en
 *   trace_api_logs y en la auditoría: con él se encuentra cualquier error reportado).
 * - Si el access token está por vencer, o la API responde TOKEN_INVALID, renueva la sesión
 *   UNA vez (single-flight: varias peticiones simultáneas esperan el mismo refresh) y reintenta.
 * - Cualquier otro 401 (sesión revocada, inactividad, reuso) cierra la sesión local.
 * - 403 PASSWORD_CHANGE_REQUIRED lleva a la pantalla de cambio obligatorio.
 */

import { coreAuth } from "@auth/store/coreAuth";
import type { TokenPayload } from "@auth/types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly traceId?: string
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  /** No adjunta token ni intenta refrescar (login, OTP, recuperación) */
  skipAuth?: boolean;
}

const newTraceId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
      );

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

async function rawFetch(path: string, opts: RequestOptions, token: string | null) {
  const traceId = newTraceId();
  const headers: Record<string, string> = { "x-trace-id": traceId };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin"
    });
  } catch {
    throw new ApiError(0, "NETWORK", "No hay conexión con el servidor", undefined, traceId);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, traceId };
}

function toError(status: number, json: unknown, traceId: string): ApiError {
  const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return new ApiError(
    status,
    err?.code ?? "UNKNOWN",
    err?.message ?? (status >= 500 ? "Error del servidor" : "Solicitud rechazada"),
    err?.details,
    traceId
  );
}

// ------------------------------------------------------------------ Sesión

let refreshing: Promise<TokenPayload> | null = null;

/** Renueva la sesión con la cookie httpOnly. Single-flight + un reintento ante carrera entre pestañas. */
export function refreshSession(): Promise<TokenPayload> {
  if (!refreshing) {
    refreshing = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { res, json, traceId } = await rawFetch("/auth/refresh", { method: "POST" }, null);
        if (res.ok) {
          const payload = json as TokenPayload;
          coreAuth.getState().setTokens(payload);
          return payload;
        }
        const error = toError(res.status, json, traceId);
        if (error.code === "REFRESH_RACE" && attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        throw error;
      }
      throw new ApiError(401, "REFRESH_INVALID", "Sesión expirada");
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Cierra la sesión local y vuelve al login con el motivo (sin llamar a la API) */
export function forceSignOut(reason: string): void {
  coreAuth.getState().resetAuth();
  const target = `/auth/sign-in?reason=${encodeURIComponent(reason)}`;
  if (!window.location.pathname.startsWith("/auth/sign-in")) window.location.assign(target);
}

async function validToken(): Promise<string | null> {
  const { accessToken, accessExpiresAt } = coreAuth.getState();
  if (accessToken && accessExpiresAt && accessExpiresAt * 1000 - Date.now() > 30_000) return accessToken;
  if (!coreAuth.getState().isAuthenticated) return null;
  try {
    return (await refreshSession()).accessToken;
  } catch (err) {
    forceSignOut(err instanceof ApiError ? err.code : "SESSION_EXPIRED");
    throw err;
  }
}

// ------------------------------------------------------------------ API pública

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let token = opts.skipAuth ? null : await validToken();
  let { res, json, traceId } = await rawFetch(path, opts, token);

  if (!opts.skipAuth && res.status === 401 && toError(401, json, traceId).code === "TOKEN_INVALID") {
    token = (await refreshSession()).accessToken;
    ({ res, json, traceId } = await rawFetch(path, opts, token));
  }

  if (res.ok) return json as T;

  const error = toError(res.status, json, traceId);
  if (!opts.skipAuth && res.status === 401) forceSignOut(error.code);
  if (error.code === "PASSWORD_CHANGE_REQUIRED") {
    const { user, setSession, modules, environment, idleMinutes } = coreAuth.getState();
    if (user) setSession({ user: { ...user, mustChangePassword: true }, modules, environment, idleMinutes });
  }
  throw error;
}

export const apiGet = <T>(path: string, query?: Query) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });
