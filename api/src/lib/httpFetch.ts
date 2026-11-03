/**
 * @project FabriHub - API
 * @file src/lib/httpFetch.ts
 * @description GET a servicios externos (fuentes de tasas) con tiempo límite y cadena TLS incompleta
 *
 * Algunos sitios oficiales (bcv.org.ve) envían solo su certificado, sin el intermedio. Los
 * navegadores lo descargan solos desde la extensión AIA del certificado («CA Issuers»); Node no.
 * Aquí se hace lo mismo: ante UNABLE_TO_VERIFY_LEAF_SIGNATURE se descarga el intermedio indicado
 * por el propio certificado y se reintenta validando contra las raíces del sistema MÁS ese
 * intermedio. La verificación nunca se apaga: un intermedio falso no encadena a ninguna raíz.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";

export interface FetchTextOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface FetchTextResult {
  status: number;
  body: string;
}

const MAX_BODY = 2 * 1024 * 1024;
/** Intermedios ya descargados, por host */
const extraCa = new Map<string, string>();

function request(url: URL, opts: FetchTextOptions, ca?: string[]): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": "FabriHub/1.0 (+tasas de cambio)", accept: "*/*", ...opts.headers },
        timeout: opts.timeoutMs ?? 20_000,
        ...(ca ? { ca } : {})
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) req.destroy(new Error("Respuesta demasiado grande"));
          else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Sin respuesta de ${url.host} en ${(opts.timeoutMs ?? 20_000) / 1000} s`)));
    req.on("error", reject);
    req.end();
  });
}

/** URL «CA Issuers» del certificado que presenta el servidor (solo se lee; no se confía en él) */
function issuerUrl(host: string, port: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 15_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const aia = cert?.infoAccess?.["CA Issuers - URI"]?.[0];
      resolve(aia ?? null);
    });
    socket.on("timeout", () => socket.destroy(new Error(`Sin respuesta TLS de ${host}`)));
    socket.on("error", reject);
  });
}

async function intermediateFor(url: URL): Promise<string | null> {
  const cached = extraCa.get(url.host);
  if (cached) return cached;
  const aia = await issuerUrl(url.hostname, Number(url.port) || 443);
  if (!aia || !/^https?:\/\//.test(aia)) return null;
  const res = await request(new URL(aia), { timeoutMs: 15_000 });
  if (res.status !== 200 || !res.body.length) return null;
  // Llega en DER (o PEM); se normaliza a PEM
  const pem = new X509Certificate(res.body).toString();
  extraCa.set(url.host, pem);
  return pem;
}

/** GET de texto. Lanza ante errores de red; el código HTTP lo evalúa quien llama */
export async function fetchText(rawUrl: string, opts: FetchTextOptions = {}): Promise<FetchTextResult> {
  const url = new URL(rawUrl);
  const known = extraCa.get(url.host);
  try {
    const res = await request(url, opts, known ? [...tls.rootCertificates, known] : undefined);
    return { status: res.status, body: res.body.toString("utf8") };
  } catch (err) {
    if ((err as { code?: string }).code !== "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || known) throw err;
    const pem = await intermediateFor(url);
    if (!pem) throw err;
    const res = await request(url, opts, [...tls.rootCertificates, pem]);
    return { status: res.status, body: res.body.toString("utf8") };
  }
}
