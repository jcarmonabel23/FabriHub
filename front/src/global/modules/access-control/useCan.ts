/**
 * @project FabriHub - Front
 * @file src/global/modules/access-control/useCan.ts
 * @description Hooks de permisos (mismo contrato que DaviHub)
 *
 *   const canAccess = useCanAccess();      canAccess("ADM_USERS")
 *   const can = useCan("ADM_USERS");       can("configure") && <Boton/>
 *
 * Se consulta por el SLUG del catálogo, sin traducir nombres: buscar quién usa un permiso es
 * un grep exacto. Ojo: esto solo decide qué se MUESTRA; quien autoriza es la API.
 */

import { useCallback } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { can as canSlug, canAccessModule, isOffline } from "./moduleTree";

export function useCanAccess(): (code: string) => boolean {
  const modules = coreAuth((s) => s.modules);
  return useCallback((code: string) => canAccessModule(modules.find((m) => m.code === code)), [modules]);
}

export function useCan(code: string): (slug: string) => boolean {
  const modules = coreAuth((s) => s.modules);
  return useCallback((slug: string) => canSlug(modules.find((m) => m.code === code), slug), [modules, code]);
}

export interface ModuleStatus {
  exists: boolean;
  offline: boolean;
  name: string;
}

export function useModuleStatus(): (code: string) => ModuleStatus {
  const modules = coreAuth((s) => s.modules);
  return useCallback(
    (code: string) => {
      const m = modules.find((x) => x.code === code);
      return { exists: Boolean(m), offline: m ? isOffline(modules, m) : false, name: m?.name ?? code };
    },
    [modules]
  );
}
