/**
 * @project FabriHub - Front
 * @file src/global/modules/metrics/useTrackModuleVisit.ts
 * @description Registra cada visita a un módulo (alimenta las métricas de uso)
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { apiPost } from "@clients/apiClient";
import { moduleForPath } from "@modules/access-control/moduleTree";

export function useTrackModuleVisit(): void {
  const { pathname } = useLocation();
  const modules = coreAuth((s) => s.modules);
  const mustChange = coreAuth((s) => s.user?.mustChangePassword);

  useEffect(() => {
    if (mustChange) return;
    const m = moduleForPath(modules, pathname);
    if (!m) return;
    apiPost("/metrics/visit", { moduleCode: m.code, path: pathname }).catch(() => undefined);
    // Solo al cambiar de ruta; un refresh de permisos no es una visita nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
