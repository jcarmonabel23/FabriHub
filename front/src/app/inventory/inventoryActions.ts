/**
 * @project FabriHub - Front
 * @file src/app/inventory/inventoryActions.ts
 * @description Navegación entre pantallas de Inventario (filtrada por acceso)
 */

import { IconArrowsExchange, IconBarcode, IconBuildingWarehouse, IconCategory, IconPackage, IconStack2 } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const INVENTORY_ACTIONS: HeaderAction[] = [
  { id: "stock", label: "Existencias", path: "/inventory/stock", icon: IconStack2, requiredCode: "INV_STOCK" },
  { id: "movements", label: "Movimientos", path: "/inventory/movements", icon: IconArrowsExchange, requiredCode: "INV_MOVEMENTS" },
  { id: "products", label: "Productos", path: "/inventory/products", icon: IconPackage, requiredCode: "INV_PRODUCTS" },
  { id: "lots", label: "Lotes", path: "/inventory/lots", icon: IconBarcode, requiredCode: "INV_LOTS" },
  { id: "warehouses", label: "Almacenes", path: "/inventory/warehouses", icon: IconBuildingWarehouse, requiredCode: "INV_WAREHOUSES" },
  { id: "catalogs", label: "Catálogos", path: "/inventory/catalogs", icon: IconCategory, requiredCode: "INV_CATALOGS" }
];
