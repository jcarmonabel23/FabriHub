/**
 * @project FabriHub - Front
 * @file src/app/production/services/production.service.ts
 * @description Llamadas a /production/*
 */

import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import type { Page } from "@admin/types";
import type {
  AvailabilityRow,
  Explosion,
  Formula,
  FormulaDetail,
  ImplosionRow,
  ProductionCenter,
  ProductionOrder,
  ProductionOrderDetail,
  Route,
  RouteDetail,
  TrackingRow,
  WorkCenter
} from "../types";

type Q = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

export type OrderAction = "release" | "unrelease" | "consume" | "confirm" | "close" | "cancel";

export const productionApi = {
  // Centros
  listCenters: () => apiGet<ProductionCenter[]>("/production/centers"),
  createCenter: (b: Body) => apiPost<ProductionCenter>("/production/centers", b),
  updateCenter: (id: string, b: Body) => apiPut<ProductionCenter>(`/production/centers/${id}`, b),
  deleteCenter: (id: string) => apiDelete<void>(`/production/centers/${id}`),
  listWorkCenters: (q: Q = {}) => apiGet<WorkCenter[]>("/production/work-centers", q),
  createWorkCenter: (b: Body) => apiPost<WorkCenter>("/production/work-centers", b),
  updateWorkCenter: (id: string, b: Body) => apiPut<WorkCenter>(`/production/work-centers/${id}`, b),
  deleteWorkCenter: (id: string) => apiDelete<void>(`/production/work-centers/${id}`),

  // Rutas
  listRoutes: (q: Q = {}) => apiGet<Route[]>("/production/routes", q),
  getRoute: (id: string) => apiGet<RouteDetail>(`/production/routes/${id}`),
  createRoute: (b: Body) => apiPost<RouteDetail>("/production/routes", b),
  updateRoute: (id: string, b: Body) => apiPut<RouteDetail>(`/production/routes/${id}`, b),
  deleteRoute: (id: string) => apiDelete<void>(`/production/routes/${id}`),

  // Fórmulas
  listFormulas: (q: Q = {}) => apiGet<Formula[]>("/production/formulas", q),
  getFormula: (id: string) => apiGet<FormulaDetail>(`/production/formulas/${id}`),
  createFormula: (b: Body) => apiPost<FormulaDetail>("/production/formulas", b),
  updateFormula: (id: string, b: Body) => apiPut<FormulaDetail>(`/production/formulas/${id}`, b),
  deleteFormula: (id: string) => apiDelete<void>(`/production/formulas/${id}`),
  explode: (productId: string, quantity: number, formulaId?: string) => apiGet<Explosion>("/production/formulas/explode", { productId, quantity, formulaId }),
  implode: (productId: string) => apiGet<ImplosionRow[]>("/production/formulas/implode", { productId }),

  // Órdenes
  listOrders: (q: Q) => apiGet<Page<ProductionOrder>>("/production/orders", q),
  getOrder: (id: string) => apiGet<ProductionOrderDetail>(`/production/orders/${id}`),
  availability: (id: string) => apiGet<{ items: AvailabilityRow[]; canRelease: boolean; shortages: number }>(`/production/orders/${id}/availability`),
  createOrder: (b: Body) => apiPost<ProductionOrderDetail>("/production/orders", b),
  updateOrder: (id: string, b: Body) => apiPut<ProductionOrderDetail>(`/production/orders/${id}`, b),
  setLineWarehouse: (id: string, lineId: string, warehouseId: string) =>
    apiPut<ProductionOrderDetail>(`/production/orders/${id}/lines/${lineId}/warehouse`, { warehouseId }),
  deleteOrder: (id: string) => apiDelete<void>(`/production/orders/${id}`),
  act: (id: string, action: OrderAction, b: Body = {}) => apiPost<ProductionOrderDetail>(`/production/orders/${id}/${action}`, b),

  // Seguimiento
  tracking: (q: Q) => apiGet<TrackingRow[]>("/production/tracking", q),
  startProcess: (id: string) => apiPost<TrackingRow>(`/production/tracking/${id}/start`, {}),
  finishProcess: (id: string, b: Body) => apiPost<TrackingRow>(`/production/tracking/${id}/finish`, b)
};
