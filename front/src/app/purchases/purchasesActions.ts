/**
 * @project FabriHub - Front
 * @file src/app/purchases/purchasesActions.ts
 * @description Navegación entre pantallas de Compras (filtrada por acceso)
 */

import { IconCurrencyDollar, IconFileInvoice, IconTruck, IconTruckDelivery, IconUserDollar } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const PURCHASES_ACTIONS: HeaderAction[] = [
  { id: "orders", label: "Órdenes", path: "/purchases/orders", icon: IconFileInvoice, requiredCode: "PUR_ORDERS" },
  { id: "receptions", label: "Recepciones", path: "/purchases/receptions", icon: IconTruckDelivery, requiredCode: "PUR_RECEPTIONS" },
  { id: "suppliers", label: "Proveedores", path: "/purchases/suppliers", icon: IconTruck, requiredCode: "PUR_SUPPLIERS" },
  { id: "price-lists", label: "Precios", path: "/purchases/price-lists", icon: IconCurrencyDollar, requiredCode: "PUR_PRICE_LISTS" },
  { id: "buyers", label: "Compradores", path: "/purchases/buyers", icon: IconUserDollar, requiredCode: "PUR_BUYERS" }
];
