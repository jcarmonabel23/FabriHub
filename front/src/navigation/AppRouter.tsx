/**
 * @project FabriHub - Front
 * @file src/navigation/AppRouter.tsx
 * @description Árbol de rutas: /auth (público) y el resto protegido por sesión y por módulo
 */

import { Navigate, Route, Routes } from "react-router-dom";
import AuthLayout from "@layouts/AuthLayout";
import DashboardLayout from "@layouts/DashboardLayout";
import SignInPage from "@auth/sign-in/Page";
import OtpVerifyPage from "@auth/otp-verify/Page";
import ChangePasswordPage from "@auth/change-password/Page";
import ForgotPasswordPage from "@auth/forgot-password/Page";
import ResetPasswordPage from "@auth/reset-password/Page";
import DashboardPage from "@dashboard/Page";
import PasswordPage from "@/app/account/PasswordPage";
import UsersAdminPage from "@admin/users/Page";
import RolesAdminPage from "@admin/roles/Page";
import ModulesAdminPage from "@admin/modules/Page";
import AuditAdminPage from "@admin/audit/Page";
import ModuleHubPage from "@/app/hub/ModuleHubPage";
import CompanyPage from "@/app/settings/company/Page";
import ParametersPage from "@/app/settings/parameters/Page";
import CommercialCatalogsPage from "@/app/settings/commercial/Page";
import TaxesPage from "@/app/taxes/taxes/Page";
import WithholdingsPage from "@/app/taxes/withholdings/Page";
import TreatmentsPage from "@/app/taxes/treatments/Page";
import StockPage from "@/app/inventory/stock/Page";
import MovementsPage from "@/app/inventory/movements/Page";
import ProductsPage from "@/app/inventory/products/Page";
import LotsPage from "@/app/inventory/lots/Page";
import WarehousesPage from "@/app/inventory/warehouses/Page";
import InventoryCatalogsPage from "@/app/inventory/catalogs/Page";
import OrdersPage from "@/app/purchases/orders/Page";
import ReceptionsPage from "@/app/purchases/receptions/Page";
import SuppliersPage from "@/app/purchases/suppliers/Page";
import PriceListsPage from "@/app/purchases/price-lists/Page";
import BuyersPage from "@/app/purchases/buyers/Page";
import QualityLotsPage from "@/app/quality/lots/Page";
import ProductionOrdersPage from "@/app/production/orders/Page";
import TrackingPage from "@/app/production/tracking/Page";
import FormulasPage from "@/app/production/formulas/Page";
import RoutesPage from "@/app/production/routes/Page";
import CentersPage from "@/app/production/centers/Page";
import StagesPage from "@/app/production/stages/Page";
import SalesOrdersPage from "@/app/sales/orders/Page";
import DeliveryNotesPage from "@/app/sales/delivery-notes/Page";
import CustomersPage from "@/app/sales/customers/Page";
import SalesPriceListsPage from "@/app/sales/price-lists/Page";
import SellersPage from "@/app/sales/sellers/Page";
import { AuthRoute, ProtectedRoute } from "./ProtectedRoute";
import { ProtectedModuleRoute } from "./ProtectedModuleRoute";
import ModulePathResolver from "./ModulePathResolver";
import { DEFAULT_REDIRECT_AUTHENTICATED } from "./routes.config";

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={DEFAULT_REDIRECT_AUTHENTICATED} replace />} />

      <Route element={<AuthLayout />}>
        <Route element={<AuthRoute />}>
          <Route path="/auth/sign-in" element={<SignInPage />} />
          <Route path="/auth/otp-verify" element={<OtpVerifyPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/change-password" element={<ChangePasswordPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/account/password" element={<PasswordPage />} />

          {/* Seguridad (fase 1) */}
          <Route element={<ProtectedModuleRoute rootCode="ADMIN" />}>
            <Route path="/admin" element={<ModuleHubPage rootCode="ADMIN" />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="ADM_USERS" />}>
            <Route path="/admin/users" element={<UsersAdminPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="ADM_ROLES" />}>
            <Route path="/admin/roles" element={<RolesAdminPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="ADM_MODULES" />}>
            <Route path="/admin/modules" element={<ModulesAdminPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="ADM_AUDIT" />}>
            <Route path="/admin/audit" element={<AuditAdminPage />} />
          </Route>

          {/* Parámetros del sistema (fase 2) */}
          <Route element={<ProtectedModuleRoute moduleCode="SET_COMPANY" />}>
            <Route path="/settings/company" element={<CompanyPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SET_PARAMETERS" />}>
            <Route path="/settings/parameters" element={<ParametersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SET_COMMERCIAL" />}>
            <Route path="/settings/commercial" element={<CommercialCatalogsPage />} />
          </Route>

          {/* Impuestos (fase 2) */}
          <Route element={<ProtectedModuleRoute moduleCode="TAX_TAXES" />}>
            <Route path="/taxes/taxes" element={<TaxesPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="TAX_WITHHOLDINGS" />}>
            <Route path="/taxes/withholdings" element={<WithholdingsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="TAX_TREATMENTS" />}>
            <Route path="/taxes/treatments" element={<TreatmentsPage />} />
          </Route>

          {/* Inventario (fase 3) */}
          <Route element={<ProtectedModuleRoute moduleCode="INV_STOCK" />}>
            <Route path="/inventory/stock" element={<StockPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="INV_MOVEMENTS" />}>
            <Route path="/inventory/movements" element={<MovementsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="INV_PRODUCTS" />}>
            <Route path="/inventory/products" element={<ProductsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="INV_LOTS" />}>
            <Route path="/inventory/lots" element={<LotsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="INV_WAREHOUSES" />}>
            <Route path="/inventory/warehouses" element={<WarehousesPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="INV_CATALOGS" />}>
            <Route path="/inventory/catalogs" element={<InventoryCatalogsPage />} />
          </Route>

          {/* Compras y Calidad (fase 4) */}
          <Route element={<ProtectedModuleRoute moduleCode="PUR_ORDERS" />}>
            <Route path="/purchases/orders" element={<OrdersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PUR_RECEPTIONS" />}>
            <Route path="/purchases/receptions" element={<ReceptionsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PUR_SUPPLIERS" />}>
            <Route path="/purchases/suppliers" element={<SuppliersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PUR_PRICE_LISTS" />}>
            <Route path="/purchases/price-lists" element={<PriceListsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PUR_BUYERS" />}>
            <Route path="/purchases/buyers" element={<BuyersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="QC_LOTS" />}>
            <Route path="/quality/lots" element={<QualityLotsPage />} />
          </Route>

          {/* Producción (fase 5) */}
          <Route element={<ProtectedModuleRoute moduleCode="PRD_ORDERS" />}>
            <Route path="/production/orders" element={<ProductionOrdersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PRD_TRACKING" />}>
            <Route path="/production/tracking" element={<TrackingPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PRD_FORMULAS" />}>
            <Route path="/production/formulas" element={<FormulasPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PRD_ROUTES" />}>
            <Route path="/production/routes" element={<RoutesPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PRD_CENTERS" />}>
            <Route path="/production/centers" element={<CentersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="PRD_STAGES" />}>
            <Route path="/production/stages" element={<StagesPage />} />
          </Route>

          {/* Ventas (fase 6) */}
          <Route element={<ProtectedModuleRoute moduleCode="SAL_ORDERS" />}>
            <Route path="/sales/orders" element={<SalesOrdersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SAL_DELIVERY_NOTES" />}>
            <Route path="/sales/delivery-notes" element={<DeliveryNotesPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SAL_CUSTOMERS" />}>
            <Route path="/sales/customers" element={<CustomersPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SAL_PRICE_LISTS" />}>
            <Route path="/sales/price-lists" element={<SalesPriceListsPage />} />
          </Route>
          <Route element={<ProtectedModuleRoute moduleCode="SAL_SELLERS" />}>
            <Route path="/sales/sellers" element={<SellersPage />} />
          </Route>

          {/* Hubs de subsistemas y pantallas de fases futuras: hub, mantenimiento o 404 */}
          <Route path="*" element={<ModulePathResolver />} />
        </Route>
      </Route>
    </Routes>
  );
}
