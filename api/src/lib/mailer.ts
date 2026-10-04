/**
 * @project FabriHub - API
 * @file src/lib/mailer.ts
 * @description Envío de correos (OTP, contraseñas temporales). En desarrollo llegan a mailpit.
 */

import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "./logger.js";

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false
});

const BRAND = "#167c94";

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:Montserrat,Arial,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 10px 25px rgba(0,0,0,.06)">
      <tr><td style="font-size:22px;font-weight:700;color:${BRAND}">FabriHub</td></tr>
      <tr><td style="padding-top:16px;font-size:18px;font-weight:600">${title}</td></tr>
      <tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#374151">${body}</td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#9ca3af">Si usted no solicitó esto, ignore el mensaje y avise al administrador.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    await transport.sendMail({ from: config.SMTP_FROM, to, subject, html });
  } catch (err) {
    // El flujo no revela si el correo falló (evita enumerar cuentas); queda en el log.
    logger.error({ err, to, subject }, "[mailer] no se pudo enviar el correo");
  }
}

export function sendOtp(to: string, code: string, purpose: "login" | "password_reset"): Promise<void> {
  const title = purpose === "login" ? "Código de verificación" : "Código para restablecer su contraseña";
  const body = `Su código es:<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND};padding:16px 0">${code}</div>
    Vence en ${config.OTP_TTL_MINUTES} minutos y solo puede usarse una vez.`;
  return send(to, `FabriHub · ${title}`, layout(title, body));
}

export function sendTemporaryPassword(to: string, names: string, password: string): Promise<void> {
  const body = `Hola ${escapeHtml(names)}, el administrador le asignó una contraseña temporal:
    <div style="font-family:monospace;font-size:20px;font-weight:700;padding:16px 0">${escapeHtml(password)}</div>
    Al ingresar, el sistema le pedirá cambiarla.`;
  return send(to, "FabriHub · Contraseña temporal", layout("Acceso a FabriHub", body));
}
