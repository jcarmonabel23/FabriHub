/**
 * @project FabriHub - Front
 * @file src/app/inventory/services/inventory.service.ts
 * @description Llamadas a /inventory/* y al buscador de productos
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type { Page } from "@admin/types";
import type {
  Alerts,
  Concept,
  KardexRow,
  Lot,
  LotDetail,
  LotOption,
  Movement,
  MovementDetail,
  Policy,
  ProductDetail,
  ProductOption,
  ProductRow,
  StockRow,
  Warehouse
} from "../types";

type Q = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

export const inventoryApi = {
  // Productos
  listProducts: (q: Q) => apiGet<Page<ProductRow>>("/inventory/products", q),
  getProduct: (id: string) => apiGet<ProductDetail>(`/inventory/products/${id}`),
  createProduct: (b: Body) => apiPost<ProductDetail>("/inventory/products", b),
  updateProduct: (id: string, b: Body) => apiPatch<ProductDetail>(`/inventory/products/${id}`, b),
  deleteProduct: (id: string) => apiDelete<void>(`/inventory/products/${id}`),
  setRelations: (id: string, relations: Body[]) => apiPut<ProductDetail>(`/inventory/products/${id}/relations`, { relations }),
  searchProducts: (search: string, stockable?: boolean, filter?: "purchased" | "sold" | "manufactured") =>
    apiGet<ProductOption[]>("/lookups/products", {
      search,
      stockable: stockable === undefined ? undefined : String(stockable),
      purchased: filter === "purchased" ? "true" : undefined,
      sold: filter === "sold" ? "true" : undefined,
      manufactured: filter === "manufactured" ? "true" : undefined
    }),

  // Almacenes
  listWarehouses: () => apiGet<Warehouse[]>("/inventory/warehouses"),
  createWarehouse: (b: Body) => apiPost<Warehouse>("/inventory/warehouses", b),
  updateWarehouse: (id: string, b: Body) => apiPatch<Warehouse>(`/inventory/warehouses/${id}`, b),
  deleteWarehouse: (id: string) => apiDelete<void>(`/inventory/warehouses/${id}`),
  listPolicies: (id: string) => apiGet<Policy[]>(`/inventory/warehouses/${id}/policies`),
  upsertPolicy: (id: string, productId: string, b: { minQty: number; maxQty: number | null }) =>
    apiPut<void>(`/inventory/warehouses/${id}/policies/${productId}`, b),
  deletePolicy: (id: string, productId: string) => apiDelete<void>(`/inventory/warehouses/${id}/policies/${productId}`),

  // Lotes
  listLots: (q: Q) => apiGet<Page<Lot>>("/inventory/lots", q),
  getLot: (id: string) => apiGet<LotDetail>(`/inventory/lots/${id}`),
  updateLot: (id: string, b: Body) => apiPatch<LotDetail>(`/inventory/lots/${id}`, b),
  holdLot: (id: string, reason: string) => apiPost<LotDetail>(`/inventory/lots/${id}/hold`, { reason }),
  releaseHold: (id: string, reason: string) => apiPost<LotDetail>(`/inventory/lots/${id}/release-hold`, { reason }),

  // Movimientos
  listMovements: (q: Q) => apiGet<Page<Movement>>("/inventory/movements", q),
  getMovement: (id: string) => apiGet<MovementDetail>(`/inventory/movements/${id}`),
  formOptions: () =>
    apiGet<{ concepts: Concept[]; warehouses: { id: string; code: string; name: string; kind: string }[] }>(
      "/inventory/movements/form-options"
    ),
  lotOptions: (productId: string, warehouseId: string) =>
    apiGet<LotOption[]>("/inventory/movements/lot-options", { productId, warehouseId }),
  createMovement: (b: Body) => apiPost<MovementDetail>("/inventory/movements", b),
  reverseMovement: (id: string) => apiPost<MovementDetail>(`/inventory/movements/${id}/reverse`),

  // Existencias
  listStock: (q: Q) => apiGet<Page<StockRow>>("/inventory/stock", q),
  summary: () =>
    apiGet<{ totalValue: number; productsWithStock: number; stockAlerts: number; lotAlerts: number }>("/inventory/stock/summary"),
  kardex: (productId: string, warehouseId: string, from?: string, to?: string) =>
    apiGet<KardexRow[]>("/inventory/stock/kardex", { productId, warehouseId, from, to }),
  alerts: () => apiGet<Alerts>("/inventory/stock/alerts"),
  stockWarehouses: () => apiGet<{ id: string; code: string; name: string }[]>("/inventory/stock/warehouses")
};
