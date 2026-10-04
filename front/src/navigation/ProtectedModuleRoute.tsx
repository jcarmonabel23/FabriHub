/**
 * @project FabriHub - Front
 * @file src/navigation/ProtectedModuleRoute.tsx
 * @description Guard de módulo: ACCESO (permiso `access`) + ESTADO (fuera de servicio), como DaviHub
 *
 *  - Sin acceso, o módulo inexistente en este entorno → al tablero, sin explicar (contarlo
 *    revelaría módulos de otros entornos).
 *  - Fuera de servicio → pantalla de mantenimiento con el nombre del módulo.
 *  - `rootCode` (hub): basta con poder entrar a UNA hoja operativa del subsistema.
 */

import { Navigate, Outlet } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { accessibleChildren, canAccessModule, isOffline } from "@modules/access-control/moduleTree";
import ModuleOffline from "@atoms/states/ModuleOffline";
import { DEFAULT_REDIRECT_AUTHENTICATED } from "./routes.config";

interface Props {
  moduleCode?: string;
  rootCode?: string;
}

export function ProtectedModuleRoute({ moduleCode, rootCode }: Readonly<Props>) {
  const modules = coreAuth((s) => s.modules);

  if (rootCode) {
    const root = modules.find((m) => m.code === rootCode);
    const kids = accessibleChildren(modules, rootCode);
    if (!root || kids.length === 0) return <Navigate to={DEFAULT_REDIRECT_AUTHENTICATED} replace />;
    if (kids.every((k) => isOffline(modules, k))) return <ModuleOffline moduleName={root.name} />;
    return <Outlet />;
  }

  const mod = modules.find((m) => m.code === moduleCode);
  if (!mod || !canAccessModule(mod)) return <Navigate to={DEFAULT_REDIRECT_AUTHENTICATED} replace />;
  if (isOffline(modules, mod)) return <ModuleOffline moduleName={mod.name} />;
  return <Outlet />;
}
