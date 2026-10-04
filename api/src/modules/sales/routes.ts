/**
 * @project FabriHub - API
 * @file src/modules/sales/routes.ts
 * @description Rutas de Ventas (/api/v1/sales). Los vendedores van por /settings/catalogs/sellers
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { priceListRoutes } from "../pricing/priceLists.js";
import {
  addCustomerContact,
  createCustomer,
  deleteCustomer,
  deleteCustomerContact,
  getCustomer,
  listCustomers,
  updateCustomer,
  updateCustomerContact
} from "./customers.js";
import { cancelDelivery, deliverOrder, getDelivery, listDeliveries, orderForDelivery, pendingOrders, traceLot } from "./deliveries.js";
import {
  approveOrder,
  cancelOrder,
  closeOrder,
  confirmOrder,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  previewOrder,
  priceSuggestion,
  reserveAgain,
  returnToDraft,
  updateOrder
} from "./orders.js";

export const salesRoutes = Router();

// Clientes y contactos
salesRoutes.get("/customers", can("SAL_CUSTOMERS", "view"), listCustomers);
salesRoutes.get("/customers/:id", can("SAL_CUSTOMERS", "view"), getCustomer);
salesRoutes.post("/customers", can("SAL_CUSTOMERS", "add_new"), createCustomer);
salesRoutes.patch("/customers/:id", can("SAL_CUSTOMERS", "edit"), updateCustomer);
salesRoutes.delete("/customers/:id", can("SAL_CUSTOMERS", "delete"), deleteCustomer);
salesRoutes.post("/customers/:id/contacts", can("SAL_CUSTOMERS", "edit"), addCustomerContact);
salesRoutes.put("/contacts/:contactId", can("SAL_CUSTOMERS", "edit"), updateCustomerContact);
salesRoutes.delete("/contacts/:contactId", can("SAL_CUSTOMERS", "edit"), deleteCustomerContact);

// Listas de precios de venta (el mismo motor de Compras)
salesRoutes.use("/price-lists", priceListRoutes("sales", "SAL_PRICE_LISTS"));

// Órdenes de venta
salesRoutes.get("/orders", can("SAL_ORDERS", "view"), listOrders);
salesRoutes.get("/orders/price-suggestion", can("SAL_ORDERS", "add_new"), priceSuggestion);
salesRoutes.post("/orders/preview", can("SAL_ORDERS", "add_new"), previewOrder);
salesRoutes.get("/orders/:id", can("SAL_ORDERS", "view"), getOrder);
salesRoutes.post("/orders", can("SAL_ORDERS", "add_new"), createOrder);
salesRoutes.put("/orders/:id", can("SAL_ORDERS", "edit"), updateOrder);
salesRoutes.delete("/orders/:id", can("SAL_ORDERS", "delete"), deleteOrder);
salesRoutes.post("/orders/:id/confirm", can("SAL_ORDERS", "edit"), confirmOrder);
salesRoutes.post("/orders/:id/approve", can("SAL_ORDERS", "approve"), approveOrder);
salesRoutes.post("/orders/:id/return-to-draft", can("SAL_ORDERS", "approve"), returnToDraft);
salesRoutes.post("/orders/:id/reserve", can("SAL_ORDERS", "edit"), reserveAgain);
salesRoutes.post("/orders/:id/cancel", can("SAL_ORDERS", "delete"), cancelOrder);
salesRoutes.post("/orders/:id/close", can("SAL_ORDERS", "close"), closeOrder);

// Notas de entrega y trazabilidad
salesRoutes.get("/deliveries", can("SAL_DELIVERY_NOTES", "view"), listDeliveries);
salesRoutes.get("/deliveries/pending-orders", can("SAL_DELIVERY_NOTES", "add_new"), pendingOrders);
salesRoutes.get("/deliveries/order/:id", can("SAL_DELIVERY_NOTES", "add_new"), orderForDelivery);
salesRoutes.get("/deliveries/trace", can("SAL_DELIVERY_NOTES", "view"), traceLot);
salesRoutes.get("/deliveries/:id", can("SAL_DELIVERY_NOTES", "view"), getDelivery);
salesRoutes.post("/orders/:id/deliveries", can("SAL_DELIVERY_NOTES", "add_new"), deliverOrder);
salesRoutes.post("/deliveries/:id/cancel", can("SAL_DELIVERY_NOTES", "delete"), cancelDelivery);
