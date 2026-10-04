/**
 * @project FabriHub - Front
 * @file src/app/sales/price-lists/Page.tsx
 * @description Ventas → Listas de precios (SAL_PRICE_LISTS): mismo motor y pantalla que Compras
 */

import PriceListsView from "@/app/pricing/PriceListsView";
import { SALES_ACTIONS } from "../salesActions";

export default function SalesPriceListsPage() {
  return (
    <PriceListsView
      scope="sales"
      module="SAL_PRICE_LISTS"
      description="Precios de venta por cliente y promociones; se sugieren al cargar la orden"
      partyLabel="Clientes"
      actions={SALES_ACTIONS}
    />
  );
}
