/**
 * @project FabriHub - Front
 * @file src/app/sales/salesActions.ts
 * @description Navegación entre pantallas de Ventas (filtrada por acceso)
 */

import { IconFileDollar, IconPackageExport, IconTags, IconUserStar, IconUsersGroup } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const SALES_ACTIONS: HeaderAction[] = [
  { id: "orders", label: "Órdenes", path: "/sales/orders", icon: IconFileDollar, requiredCode: "SAL_ORDERS" },
  { id: "deliveries", label: "Despachos", path: "/sales/delivery-notes", icon: IconPackageExport, requiredCode: "SAL_DELIVERY_NOTES" },
  { id: "customers", label: "Clientes", path: "/sales/customers", icon: IconUsersGroup, requiredCode: "SAL_CUSTOMERS" },
  { id: "price-lists", label: "Precios", path: "/sales/price-lists", icon: IconTags, requiredCode: "SAL_PRICE_LISTS" },
  { id: "sellers", label: "Vendedores", path: "/sales/sellers", icon: IconUserStar, requiredCode: "SAL_SELLERS" }
];
