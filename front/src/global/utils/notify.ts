/**
 * @project FabriHub - Front
 * @file src/global/utils/notify.ts
 * @description Notificaciones estándar de éxito/error (Mantine)
 */

import { notifications } from "@mantine/notifications";
import { ApiError } from "@clients/apiClient";

export function notifySuccess(message: string, title = "Listo"): void {
  notifications.show({ title, message, color: "teal", withBorder: true });
}

/** Muestra el mensaje de negocio de la API; en errores 5xx añade la referencia (trace id) */
export function notifyError(err: unknown, title = "No se pudo completar"): void {
  let message = "Ocurrió un error inesperado";
  if (err instanceof ApiError) {
    message = err.message;
    if (Array.isArray(err.details) && err.details.length) {
      message += `: ${err.details.map((d) => (typeof d === "string" ? d : (d as { message?: string }).message)).join(", ")}`;
    }
    if (err.status >= 500 && err.traceId) message += ` (ref. ${err.traceId.slice(0, 8)})`;
  }
  notifications.show({ title, message, color: "red", withBorder: true });
}
