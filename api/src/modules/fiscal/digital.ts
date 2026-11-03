/**
 * @project FabriHub - API
 * @file src/modules/fiscal/digital.ts
 * @description Imprenta digital: adaptador genérico (FiscalIssuer) sobre la API HTTP del proveedor
 *
 * @overview
 * Contrato genérico (los traductores de cada proveedor autorizado se agregan como otros adaptadores):
 *   GET  {api}/v1/status     → 200 si la API responde y la clave es válida
 *   POST {api}/v1/documents  → cuerpo FiscalPayload; cabeceras Authorization: Bearer <clave> e
 *                              Idempotency-Key: <id del documento>.
 *        200/201 { documentNumber, controlNumber, issuedAt, pdfBase64? | pdfUrl? }
 *        409 con el mismo cuerpo: ya se había emitido (reintento) → se toma como emitido
 *        400/422 { error: { message } }: el proveedor rechaza el documento (no se reintenta)
 *        401/403: clave inválida (no se reintenta hasta corregirla); 5xx o sin red: se reintenta
 */

import type { FiscalIssuer, FiscalPayload, FiscalResult } from "./protocol.js";

/** Error del emisor; `retry` = vale la pena reintentar más tarde */
export class FiscalError extends Error {
  constructor(
    message: string,
    readonly retry = true
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

export interface DigitalTarget {
  apiUrl: string;
  apiKey: string;
  environment: "test" | "prod";
  series: string | null;
  providerName: string;
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
    throw new FiscalError(`Sin conexión con la imprenta digital (${cause})`);
  }
}

function errorMessage(body: unknown): string | null {
  const b = body as { error?: { message?: string } | string; message?: string } | null;
  if (!b) return null;
  if (typeof b.error === "string") return b.error;
  return b.error?.message ?? b.message ?? null;
}

export class DigitalPrinterIssuer implements FiscalIssuer {
  readonly mode = "digital" as const;

  constructor(private readonly target: DigitalTarget) {}

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.target.apiKey}`, accept: "application/json", ...extra };
  }

  private base() {
    return this.target.apiUrl.replace(/\/+$/, "");
  }

  /** Prueba la conexión y la clave de API */
  async status(): Promise<{ ok: true; detail: string | null }> {
    const res = await call(`${this.base()}/v1/status`, { headers: this.headers() });
    const body = (await res.json().catch(() => null)) as { provider?: string; message?: string } | null;
    if (res.status === 401 || res.status === 403) throw new FiscalError("La imprenta digital rechazó la clave de API", false);
    if (!res.ok) throw new FiscalError(`La imprenta digital respondió ${res.status}${errorMessage(body) ? `: ${errorMessage(body)}` : ""}`);
    return { ok: true, detail: body?.provider ?? body?.message ?? null };
  }

  async issue(doc: FiscalPayload): Promise<FiscalResult> {
    const res = await call(`${this.base()}/v1/documents`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", "idempotency-key": doc.id }),
      body: JSON.stringify({ ...doc, environment: this.target.environment, series: this.target.series })
    });
    const body = (await res.json().catch(() => null)) as Partial<FiscalResult> | null;
    if (res.status === 401 || res.status === 403) throw new FiscalError("La imprenta digital rechazó la clave de API", false);
    if ((res.ok || res.status === 409) && body?.controlNumber) {
      return {
        documentNumber: body.documentNumber ?? null,
        controlNumber: String(body.controlNumber),
        machineSerial: null,
        zNumber: null,
        issuedAt: body.issuedAt ?? new Date().toISOString(),
        pdfBase64: body.pdfBase64 ?? null,
        pdfUrl: body.pdfUrl ?? null
      };
    }
    if (res.status === 400 || res.status === 409 || res.status === 422) {
      throw new FiscalError(`La imprenta digital rechazó el documento: ${errorMessage(body) ?? `HTTP ${res.status}`}`, false);
    }
    if (res.ok) throw new FiscalError("La imprenta digital respondió sin número de control");
    throw new FiscalError(`La imprenta digital respondió ${res.status}${errorMessage(body) ? `: ${errorMessage(body)}` : ""}`);
  }
}
