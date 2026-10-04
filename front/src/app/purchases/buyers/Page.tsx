/**
 * @project FabriHub - Front
 * @file src/app/purchases/buyers/Page.tsx
 * @description Compras → Compradores (PUR_BUYERS): catálogo simple con el motor genérico
 */

import ModuleHeader from "@atoms/layouts/ModuleHeader";
import type { CatalogUi } from "@/app/settings/commercial/catalogsUi";
import CatalogTab from "@/app/settings/commercial/components/CatalogTab";
import { PURCHASES_ACTIONS } from "../purchasesActions";

const BUYERS: CatalogUi = {
  key: "buyers",
  module: "PUR_BUYERS",
  label: "Compradores",
  singular: "comprador",
  feminine: false,
  codeHint: "p. ej. MPEREZ",
  codeMaxLength: 20,
  fields: [
    { key: "phone", label: "Teléfono", type: "text", default: "" },
    { key: "email", label: "Correo", type: "text", default: "" }
  ]
};

export default function BuyersPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Compradores" description="Personas que generan las órdenes de compra" actions={PURCHASES_ACTIONS} />
      <CatalogTab ui={BUYERS} />
    </div>
  );
}
