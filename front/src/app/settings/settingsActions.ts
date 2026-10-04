/**
 * @project FabriHub - Front
 * @file src/app/settings/settingsActions.ts
 * @description Navegación entre pantallas de Parámetros e Impuestos (filtradas por acceso)
 */

import { IconBuilding, IconFileCertificate, IconListDetails, IconPercentage, IconScale, IconSettings } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const SETTINGS_ACTIONS: HeaderAction[] = [
  { id: "company", label: "Empresa", path: "/settings/company", icon: IconBuilding, requiredCode: "SET_COMPANY" },
  { id: "parameters", label: "Parámetros", path: "/settings/parameters", icon: IconSettings, requiredCode: "SET_PARAMETERS" },
  { id: "commercial", label: "Catálogos", path: "/settings/commercial", icon: IconListDetails, requiredCode: "SET_COMMERCIAL" }
];

export const TAX_ACTIONS: HeaderAction[] = [
  { id: "taxes", label: "Impuestos", path: "/taxes/taxes", icon: IconPercentage, requiredCode: "TAX_TAXES" },
  { id: "withholdings", label: "Retenciones", path: "/taxes/withholdings", icon: IconScale, requiredCode: "TAX_WITHHOLDINGS" },
  { id: "treatments", label: "Tratamientos", path: "/taxes/treatments", icon: IconFileCertificate, requiredCode: "TAX_TREATMENTS" }
];

export const APPLIES_TO_OPTIONS = [
  { value: "both", label: "Compras y ventas" },
  { value: "purchases", label: "Compras" },
  { value: "sales", label: "Ventas" }
];

export const APPLIES_TO_LABEL: Record<string, string> = Object.fromEntries(APPLIES_TO_OPTIONS.map((o) => [o.value, o.label]));
