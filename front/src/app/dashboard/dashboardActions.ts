/**
 * @project FabriHub - Front
 * @file src/app/dashboard/dashboardActions.ts
 * @description Navegación entre las pantallas del Tablero (filtrada por acceso)
 */

import { IconBellRinging, IconChartBar, IconFileSpreadsheet, IconHome } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const DASHBOARD_ACTIONS: HeaderAction[] = [
  { id: "home", label: "Inicio", path: "/dashboard", icon: IconHome },
  { id: "indicators", label: "Indicadores", path: "/dashboard/indicators", icon: IconChartBar, requiredCode: "DSH_INDICATORS" },
  { id: "alerts", label: "Alertas", path: "/dashboard/alerts", icon: IconBellRinging, requiredCode: "DSH_ALERTS" },
  { id: "reports", label: "Reportes", path: "/dashboard/reports", icon: IconFileSpreadsheet, requiredCode: "DSH_REPORTS" }
];
