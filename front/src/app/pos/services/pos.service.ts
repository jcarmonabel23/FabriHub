/**
 * @project FabriHub - Front
 * @file src/app/pos/services/pos.service.ts
 * @description Llamadas a /pos/*
 */

import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import type {
  CatalogItem,
  Paged,
  PaymentMethod,
  PosCustomer,
  PosMe,
  PosSale,
  PosSaleRow,
  PosSession,
  PosSessionDetail,
  PosTerminal,
  PosTerminalInput,
  Quote,
  QuoteInput,
  SaleInput,
  SupervisorInput
} from "../types";

type Query = Record<string, string | number | boolean | null | undefined>;

export const posApi = {
  // Cajas
  listTerminals: () => apiGet<PosTerminal[]>("/pos/terminals"),
  createTerminal: (body: PosTerminalInput) => apiPost<PosTerminal>("/pos/terminals", body),
  updateTerminal: (id: string, body: PosTerminalInput) => apiPut<PosTerminal>(`/pos/terminals/${id}`, body),
  deleteTerminal: (id: string) => apiDelete<void>(`/pos/terminals/${id}`),
  /** Clave corta del supervisor (descuentos sobre el límite y anulaciones) */
  setSupervisorPin: (password: string, pin: string) => apiPut<void>("/pos/supervisor-pin", { password, pin }),

  // Turnos
  me: () => apiGet<PosMe>("/pos/me"),
  listSessions: (q: Query) => apiGet<Paged<PosSession>>("/pos/sessions", q),
  getSession: (id: string) => apiGet<PosSessionDetail>(`/pos/sessions/${id}`),
  openSession: (body: { terminalId: string; openingFloat: { currencyId: string; amount: number }[]; notes?: string | null }) =>
    apiPost<PosSessionDetail>("/pos/sessions", body),
  closeSession: (id: string, body: { counts: { method: PaymentMethod; currencyId: string; amount: number }[]; notes?: string | null }) =>
    apiPost<PosSessionDetail>(`/pos/sessions/${id}/close`, body),

  // Venta
  catalog: (terminalId: string, search: string) => apiGet<CatalogItem[]>("/pos/catalog", { terminalId, search: search || undefined, limit: 60 }),
  searchCustomers: (search: string) => apiGet<PosCustomer[]>("/pos/customers", { search }),
  createCustomer: (body: { rif: string; name: string; phone?: string | null; email?: string | null; address?: string | null }) =>
    apiPost<PosCustomer>("/pos/customers", body),
  supervisors: () => apiGet<{ id: string; names: string; hasPin: boolean }[]>("/pos/supervisors"),
  quote: (body: QuoteInput) => apiPost<Quote>("/pos/sales/quote", body),
  sell: (body: SaleInput) => apiPost<PosSale>("/pos/sales", body),

  // Comprobantes
  listSales: (q: Query) => apiGet<Paged<PosSaleRow>>("/pos/sales", q),
  getSale: (id: string) => apiGet<PosSale>(`/pos/sales/${id}`),
  voidSale: (id: string, reason: string, supervisor: SupervisorInput | null) => apiPost<PosSale>(`/pos/sales/${id}/void`, { reason, supervisor })
};
