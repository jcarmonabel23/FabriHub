/**
 * @project FabriHub - Front
 * @file src/app/pricing/priceLists.service.ts
 * @description Llamadas a /purchases/price-lists y /sales/price-lists (mismo motor en la API)
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type { PriceList, PriceListItem } from "@/app/purchases/types";

export type PriceScope = "purchases" | "sales";
type Body = Record<string, unknown>;

export const priceListsApi = (scope: PriceScope) => {
  const base = `/${scope}/price-lists`;
  return {
    list: () => apiGet<PriceList[]>(base),
    create: (b: Body) => apiPost<PriceList>(base, b),
    update: (id: string, b: Body) => apiPatch<PriceList>(`${base}/${id}`, b),
    remove: (id: string) => apiDelete<void>(`${base}/${id}`),
    items: (id: string) => apiGet<PriceListItem[]>(`${base}/${id}/items`),
    upsertItem: (id: string, productId: string, b: Body) => apiPut<void>(`${base}/${id}/items/${productId}`, b),
    deleteItem: (id: string, productId: string) => apiDelete<void>(`${base}/${id}/items/${productId}`)
  };
};
