/**
 * @project FabriHub - Front
 * @file src/app/purchases/services/purchases.service.ts
 * @description Llamadas a /purchases/* y /quality/*
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type { Page } from "@admin/types";
import type { OrderDetail, Order, Preview, PriceList, PriceListItem, QualityLot, QualityLotDetail, Reception, ReceptionDetail, Supplier } from "../types";

type Q = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

export const purchasesApi = {
  // Proveedores
  listSuppliers: (q: Q) => apiGet<Page<Supplier>>("/purchases/suppliers", q),
  getSupplier: (id: string) => apiGet<Supplier>(`/purchases/suppliers/${id}`),
  createSupplier: (b: Body) => apiPost<Supplier>("/purchases/suppliers", b),
  updateSupplier: (id: string, b: Body) => apiPatch<Supplier>(`/purchases/suppliers/${id}`, b),
  deleteSupplier: (id: string) => apiDelete<void>(`/purchases/suppliers/${id}`),
  addContact: (id: string, b: Body) => apiPost<Supplier>(`/purchases/suppliers/${id}/contacts`, b),
  updateContact: (contactId: string, b: Body) => apiPut<Supplier>(`/purchases/contacts/${contactId}`, b),
  deleteContact: (contactId: string) => apiDelete<void>(`/purchases/contacts/${contactId}`),

  // Listas de precios
  listPriceLists: () => apiGet<PriceList[]>("/purchases/price-lists"),
  createPriceList: (b: Body) => apiPost<PriceList>("/purchases/price-lists", b),
  updatePriceList: (id: string, b: Body) => apiPatch<PriceList>(`/purchases/price-lists/${id}`, b),
  deletePriceList: (id: string) => apiDelete<void>(`/purchases/price-lists/${id}`),
  listItems: (id: string) => apiGet<PriceListItem[]>(`/purchases/price-lists/${id}/items`),
  upsertItem: (id: string, productId: string, b: Body) => apiPut<void>(`/purchases/price-lists/${id}/items/${productId}`, b),
  deleteItem: (id: string, productId: string) => apiDelete<void>(`/purchases/price-lists/${id}/items/${productId}`),

  // Órdenes
  listOrders: (q: Q) => apiGet<Page<Order>>("/purchases/orders", q),
  getOrder: (id: string) => apiGet<OrderDetail>(`/purchases/orders/${id}`),
  preview: (b: Body) => apiPost<Preview>("/purchases/orders/preview", b),
  createOrder: (b: Body) => apiPost<OrderDetail>("/purchases/orders", b),
  updateOrder: (id: string, b: Body) => apiPut<OrderDetail>(`/purchases/orders/${id}`, b),
  deleteOrder: (id: string) => apiDelete<void>(`/purchases/orders/${id}`),
  transition: (id: string, action: "submit" | "approve" | "return-to-draft" | "cancel" | "close", b: Body = {}) =>
    apiPost<OrderDetail>(`/purchases/orders/${id}/${action}`, b),

  // Recepciones
  listReceptions: (q: Q) => apiGet<Page<Reception>>("/purchases/receptions", q),
  getReception: (id: string) => apiGet<ReceptionDetail>(`/purchases/receptions/${id}`),
  pendingOrders: () =>
    apiGet<{ id: string; number: string; status: string; orderDate: string; expectedDate: string | null; supplierName: string; warehouseCode: string; pendingLines: number }[]>(
      "/purchases/receptions/pending-orders"
    ),
  orderForReception: (id: string) => apiGet<OrderDetail>(`/purchases/receptions/order/${id}`),
  receive: (orderId: string, b: Body) => apiPost<ReceptionDetail>(`/purchases/orders/${orderId}/receptions`, b),
  cancelReception: (id: string, reason: string) => apiPost<ReceptionDetail>(`/purchases/receptions/${id}/cancel`, { reason }),
  returnToSupplier: (id: string, b: Body) => apiPost<ReceptionDetail>(`/purchases/receptions/${id}/returns`, b),

  // Calidad
  qualityLots: (q: Q) => apiGet<Page<QualityLot>>("/quality/lots", q),
  qualityLot: (id: string) => apiGet<QualityLotDetail>(`/quality/lots/${id}`),
  decide: (id: string, decision: "approve" | "reject", b: { notes: string; analysisRef?: string | null }) =>
    apiPost<QualityLotDetail>(`/quality/lots/${id}/${decision}`, b)
};
