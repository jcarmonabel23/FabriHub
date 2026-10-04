/**
 * @project FabriHub - Front
 * @file src/app/sales/sellers/Page.tsx
 * @description Ventas → Vendedores (SAL_SELLERS): catálogo simple con el motor genérico
 */

import ModuleHeader from "@atoms/layouts/ModuleHeader";
import type { CatalogUi } from "@/app/settings/commercial/catalogsUi";
import CatalogTab from "@/app/settings/commercial/components/CatalogTab";
import { SALES_ACTIONS } from "../salesActions";

const SELLERS: CatalogUi = {
  key: "sellers",
  module: "SAL_SELLERS",
  label: "Vendedores",
  singular: "vendedor",
  feminine: false,
  codeHint: "p. ej. AGOMEZ",
  codeMaxLength: 20,
  fields: [
    { key: "phone", label: "Teléfono", type: "text", default: "" },
    { key: "email", label: "Correo", type: "text", default: "" },
    { key: "commissionPct", label: "Comisión %", type: "number", min: 0, max: 100, default: 0, render: (v) => `${v} %` }
  ]
};

export default function SellersPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Vendedores" description="Fuerza de ventas: se asignan a clientes y órdenes" actions={SALES_ACTIONS} />
      <CatalogTab ui={SELLERS} />
    </div>
  );
}
