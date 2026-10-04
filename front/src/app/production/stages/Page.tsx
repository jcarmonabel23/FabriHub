/**
 * @project FabriHub - Front
 * @file src/app/production/stages/Page.tsx
 * @description Producción → Etapas (PRD_STAGES): catálogo simple con el motor genérico
 */

import ModuleHeader from "@atoms/layouts/ModuleHeader";
import type { CatalogUi } from "@/app/settings/commercial/catalogsUi";
import CatalogTab from "@/app/settings/commercial/components/CatalogTab";
import { PRODUCTION_ACTIONS } from "../productionActions";

const STAGES: CatalogUi = {
  key: "stages",
  module: "PRD_STAGES",
  label: "Etapas",
  singular: "etapa",
  feminine: true,
  codeHint: "p. ej. COMPRESION",
  codeMaxLength: 20,
  fields: []
};

export default function StagesPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Etapas" description="Fases del proceso productivo que componen las rutas" actions={PRODUCTION_ACTIONS} />
      <CatalogTab ui={STAGES} />
    </div>
  );
}
