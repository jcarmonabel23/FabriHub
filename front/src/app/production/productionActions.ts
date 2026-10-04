/**
 * @project FabriHub - Front
 * @file src/app/production/productionActions.ts
 * @description Navegación entre pantallas de Producción (filtrada por acceso)
 */

import { IconClipboardList, IconFlask, IconListNumbers, IconRoute, IconTimeline, IconTool } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const PRODUCTION_ACTIONS: HeaderAction[] = [
  { id: "orders", label: "Órdenes", path: "/production/orders", icon: IconClipboardList, requiredCode: "PRD_ORDERS" },
  { id: "tracking", label: "Seguimiento", path: "/production/tracking", icon: IconTimeline, requiredCode: "PRD_TRACKING" },
  { id: "formulas", label: "Fórmulas", path: "/production/formulas", icon: IconFlask, requiredCode: "PRD_FORMULAS" },
  { id: "routes", label: "Rutas", path: "/production/routes", icon: IconRoute, requiredCode: "PRD_ROUTES" },
  { id: "centers", label: "Centros", path: "/production/centers", icon: IconTool, requiredCode: "PRD_CENTERS" },
  { id: "stages", label: "Etapas", path: "/production/stages", icon: IconListNumbers, requiredCode: "PRD_STAGES" }
];
