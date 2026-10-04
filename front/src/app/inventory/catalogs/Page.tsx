/**
 * @project FabriHub - Front
 * @file src/app/inventory/catalogs/Page.tsx
 * @description Inventario → Catálogos (INV_CATALOGS): mismo motor genérico que los comerciales
 */

import { Tabs, Text } from "@mantine/core";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { INVENTORY_CATALOGS } from "@/app/settings/commercial/catalogsUi";
import CatalogTab from "@/app/settings/commercial/components/CatalogTab";
import { INVENTORY_ACTIONS } from "../inventoryActions";

export default function InventoryCatalogsPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Catálogos de inventario" description="Unidades, tipos, familias, categorías y conceptos de movimiento" actions={INVENTORY_ACTIONS} />
      <Tabs defaultValue={INVENTORY_CATALOGS[0].key} keepMounted={false}>
        <Tabs.List mb="md">
          {INVENTORY_CATALOGS.map((c) => (
            <Tabs.Tab key={c.key} value={c.key}>
              {c.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {INVENTORY_CATALOGS.map((c) => (
          <Tabs.Panel key={c.key} value={c.key}>
            {c.key === "movement-concepts" && (
              <Text size="sm" c="dimmed" mb="sm">
                Los conceptos de <b>Inventario</b> se usan en movimientos manuales; los de Compras, Ventas y Producción los
                generan sus documentos. Los conceptos del sistema se pueden renombrar o desactivar, no eliminar.
              </Text>
            )}
            <CatalogTab ui={c} />
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}
