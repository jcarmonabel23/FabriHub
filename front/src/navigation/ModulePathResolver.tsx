/**
 * @project FabriHub - Front
 * @file src/navigation/ModulePathResolver.tsx
 * @description Ruta comodín dentro de la sesión: resuelve URLs de módulos sin pantalla propia
 *
 * Si la URL corresponde a un módulo del catálogo:
 *  - raíz → hub del subsistema;  hoja fuera de servicio → mantenimiento;  sin acceso → tablero.
 * Si no corresponde a nada → 404.
 */

import { Navigate, useLocation } from "react-router-dom";
import { Button, Stack, Text, Title } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { accessibleChildren, canAccessModule, isOffline, moduleForPath } from "@modules/access-control/moduleTree";
import ModuleOffline from "@atoms/states/ModuleOffline";
import ModuleHubPage from "@/app/hub/ModuleHubPage";

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center p-10 min-h-[60vh]">
      <Stack align="center" gap="sm">
        <Title order={1} c="petrol.7">
          404
        </Title>
        <Text c="dimmed">La página que busca no existe.</Text>
        <Button variant="light" onClick={() => navigate("/dashboard")}>
          Ir al tablero
        </Button>
      </Stack>
    </div>
  );
}

export default function ModulePathResolver() {
  const { pathname } = useLocation();
  const modules = coreAuth((s) => s.modules);
  const mod = moduleForPath(modules, pathname);

  if (!mod || (mod.path !== pathname.replace(/\/$/, "") && mod.parentCode === null)) return <NotFound />;

  if (mod.parentCode === null) {
    const kids = accessibleChildren(modules, mod.code);
    if (kids.length === 0) return <Navigate to="/dashboard" replace />;
    if (kids.every((k) => isOffline(modules, k))) return <ModuleOffline moduleName={mod.name} />;
    return <ModuleHubPage rootCode={mod.code} />;
  }

  if (!canAccessModule(mod)) return <Navigate to="/dashboard" replace />;
  if (isOffline(modules, mod)) return <ModuleOffline moduleName={mod.name} />;
  return <NotFound />;
}
