/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/Page.tsx
 * @description Parámetros → Catálogos comerciales (SET_COMMERCIAL): una pestaña por catálogo
 */

import { useState } from "react";
import { Tabs } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCanAccess } from "@modules/access-control/useCan";
import { settingsApi } from "../services/settings.service";
import { SETTINGS_ACTIONS } from "../settingsActions";
import type { CatalogItem } from "../types";
import { COMMERCIAL_CATALOGS } from "./catalogsUi";
import CatalogTab from "./components/CatalogTab";
import RatesDrawer from "./components/RatesDrawer";

export default function CommercialCatalogsPage() {
  const [ratesFor, setRatesFor] = useState<CatalogItem | null>(null);
  const canAccess = useCanAccess();
  // La moneda base vive en Empresa; si no hay acceso a esa pantalla se asume VES.
  const company = useQuery({ queryKey: ["settings", "company"], queryFn: settingsApi.getCompany, enabled: canAccess("SET_COMPANY") });
  const baseCode = company.data?.baseCurrencyCode ?? "VES";

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
            <CatalogTab ui={c} onRates={c.key === "currencies" ? setRatesFor : undefined} />
          </Tabs.Panel>
        ))}
      </Tabs>
      <RatesDrawer currency={ratesFor} baseCode={baseCode} onClose={() => setRatesFor(null)} />
    </div>
  );
}
