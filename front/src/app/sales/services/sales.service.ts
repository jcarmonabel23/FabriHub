/**
 * @project FabriHub - Front
 * @file src/app/sales/services/sales.service.ts
 * @description Llamadas a /sales/* (las listas de precios van por app/pricing)
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type { Page } from "@admin/types";
import type { Preview } from "@/app/purchases/types";
import type { Customer, Delivery, DeliveryDetail, DeliveryLot, LotTrace, PendingSalesOrder, SalesOrder, SalesOrderDetail } from "../types";

type Q = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

export type SalesAction = "confirm" | "approve" | "return-to-draft" | "reserve" | "cancel" | "close";

export const salesApi = {
  // Clientes
  listCustomers: (q: Q) => apiGet<Page<Customer>>("/sales/customers", q),
  getCustomer: (id: string) => apiGet<Customer>(`/sales/customers/${id}`),
  createCustomer: (b: Body) => apiPost<Customer>("/sales/customers", b),
  updateCustomer: (id: string, b: Body) => apiPatch<Customer>(`/sales/customers/${id}`, b),
  deleteCustomer: (id: string) => apiDelete<void>(`/sales/customers/${id}`),
  addContact: (id: string, b: Body) => apiPost<Customer>(`/sales/customers/${id}/contacts`, b),
  updateContact: (contactId: string, b: Body) => apiPut<Customer>(`/sales/contacts/${contactId}`, b),
  deleteContact: (contactId: string) => apiDelete<void>(`/sales/contacts/${contactId}`),

  // Órdenes
  listOrders: (q: Q) => apiGet<Page<SalesOrder>>("/sales/orders", q),
  getOrder: (id: string) => apiGet<SalesOrderDetail>(`/sales/orders/${id}`),
  preview: (b: Body) => apiPost<Preview>("/sales/orders/preview", b),
  createOrder: (b: Body) => apiPost<SalesOrderDetail>("/sales/orders", b),
  updateOrder: (id: string, b: Body) => apiPut<SalesOrderDetail>(`/sales/orders/${id}`, b),
  deleteOrder: (id: string) => apiDelete<void>(`/sales/orders/${id}`),
  act: (id: string, action: SalesAction, b: Body = {}) => apiPost<SalesOrderDetail>(`/sales/orders/${id}/${action}`, b),

  // Despacho
  listDeliveries: (q: Q) => apiGet<Page<Delivery>>("/sales/deliveries", q),
  getDelivery: (id: string) => apiGet<DeliveryDetail>(`/sales/deliveries/${id}`),
  pendingOrders: () => apiGet<PendingSalesOrder[]>("/sales/deliveries/pending-orders"),
  orderForDelivery: (id: string) => apiGet<SalesOrderDetail & { lots: DeliveryLot[] }>(`/sales/deliveries/order/${id}`),
  deliver: (orderId: string, b: Body) => apiPost<DeliveryDetail>(`/sales/orders/${orderId}/deliveries`, b),
  cancelDelivery: (id: string, reason: string) => apiPost<DeliveryDetail>(`/sales/deliveries/${id}/cancel`, { reason }),
  traceLot: (lotCode: string) => apiGet<LotTrace[]>("/sales/deliveries/trace", { lotCode })
};
