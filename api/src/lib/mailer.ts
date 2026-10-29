/**
 * @project FabriHub - API
 * @file src/lib/mailer.ts
 * @description Envío de correos (OTP, contraseñas temporales, alertas). En desarrollo llegan a mailpit;
 *              en producción, al proveedor SMTP configurado (SMTP_USER / SMTP_PASSWORD).
 *
 * Con la identidad de una empresa (fase 12), el correo lleva su logo incrustado (CID, sin enlaces
 * externos), su nombre en el asunto y su color; sin ella, la marca FabriHub.
 */

import nodemailer from "nodemailer";
import type { Branding } from "../modules/settings/branding.js";
import { config } from "../config.js";
import { logger } from "./logger.js";

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  // Con credenciales (proveedor real) se exige cifrado; mailpit en desarrollo va sin autenticación.
  requireTLS: Boolean(config.SMTP_USER) && !config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined
});

const FABRIHUB = "#167c94";
const LOGO_CID = "company-logo@fabrihub";
const LOGO_HEIGHT = 48;

interface Mail {
  html: string;
  attachments: { filename: string; content: Buffer; cid: string; contentType: string }[];
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const colorOf = (brand: Branding | null) => brand?.brandColor ?? FABRIHUB;
const prefixOf = (brand: Branding | null) => brand?.name ?? "FabriHub";

/**
 * Plantilla común. La cabecera es el logo de la empresa (incrustado) o su nombre; sin empresa, FabriHub.
 * `body` ya viene escapado por quien llama.
 */
function layout(
  brand: Branding | null,
  title: string,
  body: string,
  footer = "Si usted no solicitó esto, ignore el mensaje y avise al administrador."
): Mail {
  const color = colorOf(brand);
  const attachments: Mail["attachments"] = [];
  let head = `<div style="font-size:22px;font-weight:700;color:${color}">${escapeHtml(prefixOf(brand))}</div>`;
  if (brand?.logo) {
    attachments.push({ filename: "logo.png", content: brand.logo.png, cid: LOGO_CID, contentType: "image/png" });
    const width = Math.round((brand.logo.width / brand.logo.height) * LOGO_HEIGHT);
    head = `<img src="cid:${LOGO_CID}" alt="${escapeHtml(brand.name)}" height="${LOGO_HEIGHT}" width="${width}" style="display:block;border:0;max-width:100%;height:auto">`;
  }
  const by = brand ? `<br>${escapeHtml(brand.legalName)} · RIF ${escapeHtml(brand.rif)} · enviado con FabriHub` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:Montserrat,Arial,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;border-top:4px solid ${color};box-shadow:0 10px 25px rgba(0,0,0,.06)">
      <tr><td>${head}</td></tr>
      <tr><td style="padding-top:16px;font-size:18px;font-weight:600">${title}</td></tr>
      <tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#374151">${body}</td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#9ca3af">${footer}${by}</td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { html, attachments };
}

async function send(to: string, subject: string, mail: Mail): Promise<boolean> {
  try {
    await transport.sendMail({ from: config.SMTP_FROM, to, subject, html: mail.html, attachments: mail.attachments });
    return true;
  } catch (err) {
    // El flujo no revela si el correo falló (evita enumerar cuentas); queda en el log.
    logger.error({ err, to, subject }, "[mailer] no se pudo enviar el correo");
    return false;
  }
}

/** `brand`: la empresa por defecto del usuario (aún no hay sesión) */
export async function sendOtp(to: string, code: string, purpose: "login" | "password_reset", brand: Branding | null = null): Promise<void> {
  const title = purpose === "login" ? "Código de verificación" : "Código para restablecer su contraseña";
  const body = `Su código es:<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:${colorOf(brand)};padding:16px 0">${code}</div>
    Vence en ${config.OTP_TTL_MINUTES} minutos y solo puede usarse una vez.`;
  await send(to, `${prefixOf(brand)} · ${title}`, layout(brand, title, body));
}

/** `brand`: la empresa donde se dio el acceso */
export async function sendTemporaryPassword(to: string, names: string, password: string, brand: Branding | null = null): Promise<void> {
  const body = `Hola ${escapeHtml(names)}, el administrador le asignó una contraseña temporal:
    <div style="font-family:monospace;font-size:20px;font-weight:700;padding:16px 0">${escapeHtml(password)}</div>
    Al ingresar en <a href="${config.APP_PUBLIC_URL}" style="color:${colorOf(brand)}">${escapeHtml(config.APP_PUBLIC_URL)}</a>, el sistema le pedirá cambiarla.`;
  await send(to, `${prefixOf(brand)} · Contraseña temporal`, layout(brand, `Acceso a ${escapeHtml(prefixOf(brand))}`, body));
}

const SEVERITY_COLOR = { critical: "#dc2626", warning: "#d97706", info: "#2563eb" } as const;
const SEVERITY_LABEL = { critical: "Crítica", warning: "Advertencia", info: "Aviso" } as const;

export interface DigestItem {
  severity: keyof typeof SEVERITY_COLOR;
  title: string;
  message: string;
  link: string | null;
}

/** Resumen de alertas nuevas de una corrida del detector. Devuelve si se envió. */
export function sendAlertDigest(to: string, names: string, items: DigestItem[], brand: Branding | null = null): Promise<boolean> {
  const rows = items
    .map((i) => {
      const href = i.link ? `${config.APP_PUBLIC_URL}${i.link}` : config.APP_PUBLIC_URL;
      return `<tr><td style="padding:10px 0;border-top:1px solid #e5e7eb">
        <span style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${SEVERITY_COLOR[i.severity]};border-radius:4px;padding:2px 6px">${SEVERITY_LABEL[i.severity]}</span>
        <a href="${escapeHtml(href)}" style="font-weight:600;color:#111827;text-decoration:none;margin-left:6px">${escapeHtml(i.title)}</a>
        <div style="font-size:13px;color:#4b5563;padding-top:4px">${escapeHtml(i.message)}</div></td></tr>`;
    })
    .join("");
  const body = `Hola ${escapeHtml(names)}, el detector encontró ${items.length === 1 ? "una alerta nueva" : `${items.length} alertas nuevas`}:
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${rows}</table>
    <div style="padding-top:16px"><a href="${config.APP_PUBLIC_URL}/dashboard/alerts" style="color:${colorOf(brand)};font-weight:600">Ver todas las alertas</a></div>`;
  const subject = `${prefixOf(brand)} · ${items.length === 1 ? "1 alerta nueva" : `${items.length} alertas nuevas`}`;
  return send(
    to,
    subject,
    layout(brand, `Alertas de ${escapeHtml(prefixOf(brand))}`, body, "Recibe este correo porque tiene acceso a los módulos de estas alertas.")
  );
}
