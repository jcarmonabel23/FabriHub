/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/Page.tsx
 * @description Parámetros → Catálogos comerciales (SET_COMMERCIAL): una pestaña por catálogo
 */

import { useState } from "react";
import { Tabs } from "@mantine/core";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { coreAuth } from "@auth/store/coreAuth";
import { SETTINGS_ACTIONS } from "../settingsActions";
import type { CatalogItem } from "../types";
import { COMMERCIAL_CATALOGS } from "./catalogsUi";
import AutoRatesPanel from "./components/AutoRatesPanel";
import CatalogTab from "./components/CatalogTab";
import RatesDrawer from "./components/RatesDrawer";

export default function CommercialCatalogsPage() {
  const [ratesFor, setRatesFor] = useState<CatalogItem | null>(null);
  // Moneda base de la empresa activa (viene en la sesión)
  const baseCode = coreAuth((s) => s.company?.baseCurrencyCode) ?? "VES";

  return (
    <div className="p-6">
      <ModuleHeader title="Catálogos comerciales" description="Condiciones, métodos, zonas, tipos de negocio y monedas" actions={SETTINGS_ACTIONS} />
      <Tabs defaultValue={COMMERCIAL_CATALOGS[0].key} keepMounted={false}>
        <Tabs.List mb="md">
          {COMMERCIAL_CATALOGS.map((c) => (
            <Tabs.Tab key={c.key} value={c.key}>
              {c.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {COMMERCIAL_CATALOGS.map((c) => (
          <Tabs.Panel key={c.key} value={c.key}>
            {c.key === "currencies" && <AutoRatesPanel baseCode={baseCode} />}
            <CatalogTab ui={c} onRates={c.key === "currencies" ? setRatesFor : undefined} />
          </Tabs.Panel>
        ))}
      </Tabs>
      <RatesDrawer currency={ratesFor} baseCode={baseCode} onClose={() => setRatesFor(null)} />
    </div>
  );
}
