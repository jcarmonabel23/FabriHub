/**
 * @project FabriHub - Front
 * @file src/app/pos/posActions.ts
 * @description Navegación entre pantallas del punto de venta (filtrada por acceso)
 */

import { IconCash, IconDeviceDesktop, IconReceipt, IconShoppingBag } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const POS_ACTIONS: HeaderAction[] = [
  { id: "sales", label: "Caja", path: "/pos/sales", icon: IconShoppingBag, requiredCode: "POS_SALES" },
  { id: "tickets", label: "Comprobantes", path: "/pos/sales/tickets", icon: IconReceipt, requiredCode: "POS_SALES" },
  { id: "sessions", label: "Turnos", path: "/pos/sessions", icon: IconCash, requiredCode: "POS_SESSIONS" },
  { id: "terminals", label: "Cajas", path: "/pos/terminals", icon: IconDeviceDesktop, requiredCode: "POS_TERMINALS" }
];
