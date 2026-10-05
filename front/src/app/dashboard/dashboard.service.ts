/**
 * @project FabriHub - Front
 * @file src/app/dashboard/dashboard.service.ts
 * @description Llamadas y modelos del Tablero: indicadores, alertas, reportes y notificaciones (campana)
 */

import { apiDownload, apiGet, apiPost } from "@clients/apiClient";

export type Severity = "info" | "warning" | "critical";
export type AlertKind = "STOCK_MIN" | "STOCK_MAX" | "LOT_EXPIRING" | "LOT_EXPIRED" | "QC_PENDING" | "PO_OVERDUE" | "PRO_LATE" | "SO_LATE";

export const KIND_LABEL: Record<AlertKind, string> = {
  STOCK_MIN: "Stock bajo el mínimo",
  STOCK_MAX: "Stock sobre el máximo",
  LOT_EXPIRING: "Lote por vencer",
  LOT_EXPIRED: "Lote vencido",
  QC_PENDING: "Cuarentena prolongada",
  PO_OVERDUE: "OC atrasada",
  PRO_LATE: "OP atrasada",
  SO_LATE: "OV atrasada"
};

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Crítica", warning: "Advertencia", info: "Aviso" };
export const SEVERITY_COLOR: Record<Severity, string> = { critical: "red", warning: "orange", info: "blue" };

// ------------------------------------------------------------------ Notificaciones

export interface Notification {
  id: string;
  kind: AlertKind;
  severity: Severity;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  isResolved: boolean;
  createdAt: string;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
  total: number;
}

// ------------------------------------------------------------------ Alertas

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: Severity;
  moduleCode: string;
  moduleName: string;
  title: string;
  message: string;
  link: string | null;
  warehouseCode: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface AlertsSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  byKind: Partial<Record<AlertKind, number>>;
  lastRun: { startedAt: string; finishedAt: string; trigger: string; error: string | null } | null;
}

export interface AlertRun {
  id: string;
  trigger: "schedule" | "manual";
  runBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  openAlerts: number;
  newAlerts: number;
  resolvedAlerts: number;
  notifications: number;
  emails: number;
  error: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ------------------------------------------------------------------ Indicadores

export interface MonthPoint {
  month: string;
}

export interface Indicators {
  generatedAt: string;
  currency: { code: string; symbol: string | null };
  inventory: {
    totalValue: number;
    productsWithStock: number;
    belowMin: number;
    expiringLots: number;
    expiredLots: number;
    quarantineLots: number;
    outflowCost90: number;
    turnover: number | null;
    coverageDays: number | null;
    valueByType: { type: string; value: number }[];
    restricted: boolean;
  } | null;
  quality: { quarantine: number; approved90: number; rejected90: number; approvalRate: number | null; avgReleaseDays: number | null } | null;
  production: {
    open: number;
    late: number;
    byStatus: { status: string; count: number }[];
    onTimeRate: number | null;
    variancePct: number | null;
    monthly: (MonthPoint & { orders: number; produced: number })[];
  } | null;
  purchases: {
    open: number;
    pendingApproval: number;
    overdue: number;
    openAmount: number;
    supplierOnTimeRate: number | null;
    monthly: (MonthPoint & { amount: number; orders: number })[];
    topSuppliers: { supplier: string; amount: number }[];
  } | null;
  sales: {
    open: number;
    late: number;
    openAmount: number;
    backorderLines: number;
    onTimeRate: number | null;
    monthly: (MonthPoint & { sales: number; cost: number; margin: number })[];
    topProducts: { code: string; name: string; amount: number; quantity: number }[];
    restricted: boolean;
  } | null;
  planning: { lastRunAt: string | null; period: string | null; openSuggestions: { make: number; buy: number; late: number } } | null;
}

// ------------------------------------------------------------------ Reportes

export interface ReportInfo {
  code: string;
  name: string;
  description: string;
  module: string;
  moduleName: string;
  ranged: boolean;
}

export interface ReportColumn {
  key: string;
  header: string;
  type: "text" | "int" | "qty" | "money" | "pct" | "date" | "datetime";
  total?: boolean;
}

export interface ReportPreview {
  code: string;
  name: string;
  ranged: boolean;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  total: number;
}

export interface Range {
  from?: string;
  to?: string;
}

export const dashboardApi = {
  notifications: (unread?: boolean) => apiGet<NotificationList>("/notifications", { unread: unread === undefined ? undefined : String(unread), limit: 30 }),
  markRead: (id: string) => apiPost<void>(`/notifications/${id}/read`),
  markAllRead: () => apiPost<{ updated: number }>("/notifications/read-all"),

  indicators: () => apiGet<Indicators>("/dashboard/indicators"),

  alerts: (q: { status: "open" | "resolved"; kind?: string | null; severity?: string | null; search?: string; page: number; pageSize: number }) =>
    apiGet<Paged<Alert>>("/dashboard/alerts", q),
  alertsSummary: () => apiGet<AlertsSummary>("/dashboard/alerts/summary"),
  alertRuns: () => apiGet<AlertRun[]>("/dashboard/alerts/runs"),
  runAlerts: () =>
    apiPost<{ id: string; openAlerts: number; newAlerts: number; resolvedAlerts: number; notifications: number; emails: number }>("/dashboard/alerts/run"),

  reports: () => apiGet<ReportInfo[]>("/dashboard/reports"),
  preview: (code: string, range: Range) => apiGet<ReportPreview>(`/dashboard/reports/${code}/preview`, { ...range }),
  download: (code: string, range: Range) => apiDownload(`/dashboard/reports/${code}/xlsx`, { ...range })
};
