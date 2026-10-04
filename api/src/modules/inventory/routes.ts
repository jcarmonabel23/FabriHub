/**
 * @project FabriHub - API
 * @file src/modules/inventory/routes.ts
 * @description Rutas de Inventario (/api/v1/inventory). Cada ruta declara módulo + permiso.
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { getLot, listLots, lotOptions, setLotHold, updateLot } from "./lots.js";
import { createMovement, getMovement, listMovements, movementFormOptions, reverseMovement } from "./movements.js";
import { createProduct, deleteProduct, getProduct, listProducts, setRelations, updateProduct } from "./products.js";
import { kardex, listStock, stockAlerts, stockSummary, stockWarehouses } from "./stock.js";
import {
  createWarehouse,
  deletePolicy,
  deleteWarehouse,
  listPolicies,
  listWarehouses,
  updateWarehouse,
  upsertPolicy
} from "./warehouses.js";

export const inventoryRoutes = Router();

// Productos
inventoryRoutes.get("/products", can("INV_PRODUCTS", "view"), listProducts);
inventoryRoutes.get("/products/:id", can("INV_PRODUCTS", "view"), getProduct);
inventoryRoutes.post("/products", can("INV_PRODUCTS", "add_new"), createProduct);
inventoryRoutes.patch("/products/:id", can("INV_PRODUCTS", "edit"), updateProduct);
inventoryRoutes.delete("/products/:id", can("INV_PRODUCTS", "delete"), deleteProduct);
inventoryRoutes.put("/products/:id/relations", can("INV_PRODUCTS", "edit"), setRelations);

// Almacenes y políticas de stock
inventoryRoutes.get("/warehouses", can("INV_WAREHOUSES", "view"), listWarehouses);
inventoryRoutes.post("/warehouses", can("INV_WAREHOUSES", "add_new"), createWarehouse);
inventoryRoutes.patch("/warehouses/:id", can("INV_WAREHOUSES", "edit"), updateWarehouse);
inventoryRoutes.delete("/warehouses/:id", can("INV_WAREHOUSES", "delete"), deleteWarehouse);
inventoryRoutes.get("/warehouses/:id/policies", can("INV_WAREHOUSES", "view"), listPolicies);
inventoryRoutes.put("/warehouses/:id/policies/:productId", can("INV_WAREHOUSES", "edit"), upsertPolicy);
inventoryRoutes.delete("/warehouses/:id/policies/:productId", can("INV_WAREHOUSES", "edit"), deletePolicy);

// Lotes
inventoryRoutes.get("/lots", can("INV_LOTS", "view"), listLots);
inventoryRoutes.get("/lots/:id", can("INV_LOTS", "view"), getLot);
inventoryRoutes.patch("/lots/:id", can("INV_LOTS", "edit"), updateLot);
inventoryRoutes.post("/lots/:id/hold", can("INV_LOTS", "edit"), setLotHold(true));
inventoryRoutes.post("/lots/:id/release-hold", can("INV_LOTS", "edit"), setLotHold(false));

// Movimientos (los contabilizados no se editan ni borran: se reversan)
inventoryRoutes.get("/movements", can("INV_MOVEMENTS", "view"), listMovements);
inventoryRoutes.get("/movements/form-options", can("INV_MOVEMENTS", "add_new"), movementFormOptions);
inventoryRoutes.get("/movements/lot-options", can("INV_MOVEMENTS", "add_new"), lotOptions);
inventoryRoutes.get("/movements/:id", can("INV_MOVEMENTS", "view"), getMovement);
inventoryRoutes.post("/movements", can("INV_MOVEMENTS", "add_new"), createMovement);
inventoryRoutes.post("/movements/:id/reverse", can("INV_MOVEMENTS", "delete"), reverseMovement);

// Existencias, kárdex y alertas
inventoryRoutes.get("/stock", can("INV_STOCK", "view"), listStock);
inventoryRoutes.get("/stock/summary", can("INV_STOCK", "view"), stockSummary);
inventoryRoutes.get("/stock/kardex", can("INV_STOCK", "view"), kardex);
inventoryRoutes.get("/stock/alerts", can("INV_STOCK", "view"), stockAlerts);
inventoryRoutes.get("/stock/warehouses", can("INV_STOCK", "view"), stockWarehouses);
