/**
 * @project FabriHub - Front
 * @file src/app/purchases/price-lists/Page.tsx
 * @description Compras → Listas de precios (PUR_PRICE_LISTS): precios por producto y promociones
 */

import PriceListsView from "@/app/pricing/PriceListsView";
import { PURCHASES_ACTIONS } from "../purchasesActions";

export default function PriceListsPage() {
  return (
    <PriceListsView
      scope="purchases"
      module="PUR_PRICE_LISTS"
      description="Precios de compra por proveedor; se sugieren al cargar la orden"
      partyLabel="Proveedores"
      actions={PURCHASES_ACTIONS}
    />
  );
}
