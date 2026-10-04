/**
 * @project FabriHub - API
 * @file src/modules/purchases/routes.ts
 * @description Rutas de Compras (/api/v1/purchases) y Calidad (/api/v1/quality)
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { priceListRoutes } from "../pricing/priceLists.js";
import { approveLot, getQualityLot, listQualityLots, rejectLot } from "../quality/lots.js";
import {
  approveOrder,
  cancelOrder,
  closeOrder,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  previewOrder,
  priceSuggestion,
  returnToDraft,
  submitOrder,
  updateOrder
} from "./orders.js";
import {
  cancelReception,
  getReception,
  listReceptions,
  orderForReception,
  pendingOrders,
  receiveOrder,
  returnToSupplier
} from "./receptions.js";
import {
  addContact,
  createSupplier,
  deleteContact,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateContact,
  updateSupplier
} from "./suppliers.js";

export const purchasesRoutes = Router();

// Proveedores y contactos
purchasesRoutes.get("/suppliers", can("PUR_SUPPLIERS", "view"), listSuppliers);
purchasesRoutes.get("/suppliers/:id", can("PUR_SUPPLIERS", "view"), getSupplier);
purchasesRoutes.post("/suppliers", can("PUR_SUPPLIERS", "add_new"), createSupplier);
purchasesRoutes.patch("/suppliers/:id", can("PUR_SUPPLIERS", "edit"), updateSupplier);
purchasesRoutes.delete("/suppliers/:id", can("PUR_SUPPLIERS", "delete"), deleteSupplier);
purchasesRoutes.post("/suppliers/:id/contacts", can("PUR_SUPPLIERS", "edit"), addContact);
purchasesRoutes.put("/contacts/:contactId", can("PUR_SUPPLIERS", "edit"), updateContact);
purchasesRoutes.delete("/contacts/:contactId", can("PUR_SUPPLIERS", "edit"), deleteContact);

// Listas de precios de compra (mismo motor que usará Ventas)
purchasesRoutes.use("/price-lists", priceListRoutes("purchases", "PUR_PRICE_LISTS"));

// Órdenes de compra
purchasesRoutes.get("/orders", can("PUR_ORDERS", "view"), listOrders);
purchasesRoutes.get("/orders/price-suggestion", can("PUR_ORDERS", "add_new"), priceSuggestion);
purchasesRoutes.post("/orders/preview", can("PUR_ORDERS", "add_new"), previewOrder);
purchasesRoutes.get("/orders/:id", can("PUR_ORDERS", "view"), getOrder);
purchasesRoutes.post("/orders", can("PUR_ORDERS", "add_new"), createOrder);
purchasesRoutes.put("/orders/:id", can("PUR_ORDERS", "edit"), updateOrder);
purchasesRoutes.delete("/orders/:id", can("PUR_ORDERS", "delete"), deleteOrder);
purchasesRoutes.post("/orders/:id/submit", can("PUR_ORDERS", "edit"), submitOrder);
purchasesRoutes.post("/orders/:id/approve", can("PUR_ORDERS", "approve"), approveOrder);
purchasesRoutes.post("/orders/:id/return-to-draft", can("PUR_ORDERS", "approve"), returnToDraft);
purchasesRoutes.post("/orders/:id/cancel", can("PUR_ORDERS", "delete"), cancelOrder);
purchasesRoutes.post("/orders/:id/close", can("PUR_ORDERS", "close"), closeOrder);

// Recepciones y devoluciones
purchasesRoutes.get("/receptions", can("PUR_RECEPTIONS", "view"), listReceptions);
purchasesRoutes.get("/receptions/pending-orders", can("PUR_RECEPTIONS", "add_new"), pendingOrders);
purchasesRoutes.get("/receptions/order/:id", can("PUR_RECEPTIONS", "add_new"), orderForReception);
purchasesRoutes.get("/receptions/:id", can("PUR_RECEPTIONS", "view"), getReception);
purchasesRoutes.post("/orders/:id/receptions", can("PUR_RECEPTIONS", "add_new"), receiveOrder);
purchasesRoutes.post("/receptions/:id/cancel", can("PUR_RECEPTIONS", "delete"), cancelReception);
purchasesRoutes.post("/receptions/:id/returns", can("PUR_RECEPTIONS", "add_new"), returnToSupplier);

export const qualityRoutes = Router();
qualityRoutes.get("/lots", can("QC_LOTS", "view"), listQualityLots);
qualityRoutes.get("/lots/:id", can("QC_LOTS", "view"), getQualityLot);
qualityRoutes.post("/lots/:id/approve", can("QC_LOTS", "approve"), approveLot);
qualityRoutes.post("/lots/:id/reject", can("QC_LOTS", "approve"), rejectLot);
