/**
 * @project FabriHub - Front
 * @file src/app/settings/einvoice/einvoice.service.ts
 * @description Comprobantes electrónicos de Costa Rica (fase 18): configuración, credenciales del ATV,
 * llave criptográfica y bitácora de comprobantes enviados a Hacienda
 */

import { apiDelete, apiDownload, apiGet, apiPost, apiPut } from "@clients/apiClient";

export type EinvDocType = "FE" | "TE" | "NC";
export type EinvStatus = "pending" | "sent" | "accepted" | "rejected" | "cancelled";

export interface EinvoiceSettings {
  isEnabled: boolean;
  environment: "sandbox" | "prod";
  activityCode: string | null;
  providerId: string | null;
  province: number | null;
  canton: string | null;
  district: string | null;
  neighborhood: string | null;
  otherSigns: string | null;
  serviceUnit: "Sp" | "Spe" | "Os" | "St" | "h";
  contingency: boolean;
  /** URL simuladas de Hacienda (solo se usan en el ambiente de pruebas) */
  mockUrls: { idpUrl: string | null; apiUrl: string | null } | null;
  company: { email: string | null; taxId: string | null; idType: string | null };
  credentials: { configured: boolean; userHint: string | null; updatedAt: string | null };
  certificate: { configured: boolean; subject: string | null; expiresAt: string | null };
  counts: Partial<Record<EinvStatus, number>>;
}

export type EinvoiceSettingsInput = Omit<EinvoiceSettings, "mockUrls" | "company" | "credentials" | "certificate" | "counts"> & {
  idpUrl?: string | null;
  apiUrl?: string | null;
};

export interface EinvDocument {
  id: string;
  docType: EinvDocType;
  docName: string;
  clave: string;
  consecutive: string;
  situation: "1" | "2" | "3";
  environment: "sandbox" | "prod";
  issuedAt: string;
  total: number;
  status: EinvStatus;
  attempts: number;
  lastError: string | null;
  responseMessage: string | null;
  saleId: string;
  ticketNumber: string;
  customerName: string;
  customerTaxId: string;
  referenceClave: string | null;
  referenceConsecutive: string | null;
  reason: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  nextAttemptAt: string;
  hasXml: boolean;
  hasResponse: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const EINV_STATUS: Record<EinvStatus, { label: string; color: string }> = {
  pending: { label: "Por enviar", color: "orange" },
  sent: { label: "En validación", color: "blue" },
  accepted: { label: "Aceptado", color: "teal" },
  rejected: { label: "Rechazado", color: "red" },
  cancelled: { label: "No enviado", color: "gray" }
};

/** Lee un archivo como base64 (sin el prefijo data:) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export const einvoiceApi = {
  settings: () => apiGet<EinvoiceSettings>("/einvoice/settings"),
  saveSettings: (body: EinvoiceSettingsInput) => apiPut<EinvoiceSettings>("/einvoice/settings", body),
  saveCredentials: (username: string, password: string) =>
    apiPut<{ configured: boolean; userHint: string }>("/einvoice/credentials", { username, password }),
  deleteCredentials: () => apiDelete<void>("/einvoice/credentials"),
  saveCertificate: (p12: string, pin: string) => apiPut<{ subject: string; expiresAt: string }>("/einvoice/certificate", { p12, pin }),
  deleteCertificate: () => apiDelete<void>("/einvoice/certificate"),
  processQueue: () => apiPost<{ processed: number; counts: Partial<Record<EinvStatus, number>> }>("/einvoice/process"),
  documents: (q: { page: number; pageSize: number; status?: string | null; docType?: string | null; search?: string; saleId?: string }) =>
    apiGet<Page<EinvDocument>>("/einvoice/documents", q),
  retry: (id: string) => apiPost<EinvDocument>(`/einvoice/documents/${id}/retry`),
  downloadXml: (id: string, kind: "signed" | "response") => apiDownload(`/einvoice/documents/${id}/xml`, { kind })
};
