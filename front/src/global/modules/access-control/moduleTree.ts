/**
 * @project FabriHub - Front
 * @file src/global/modules/access-control/moduleTree.ts
 * @description Reglas puras de acceso sobre los módulos de la sesión (sin React: se prueban solas)
 *
 * @overview
 * Una sola regla para tablero, sidebar, hubs y rutas (como en DaviHub):
 *  - Hoja: se puede entrar si es pública o trae el permiso `access`.
 *  - Raíz (subsistema): se muestra si el usuario puede entrar a alguna de sus hojas.
 *  - Estado: una hoja `isOffline` (o cuya raíz lo esté) se ve deshabilitada y su ruta muestra
 *    la pantalla de fuera de servicio. Lo que no está en la sesión no existe en este entorno.
 */

import type { SessionModule } from "@auth/types";

export const canAccessModule = (m: SessionModule | undefined): boolean =>
  Boolean(m && (m.isPublic || m.permissions.includes("access")));

export const can = (m: SessionModule | undefined, slug: string): boolean =>
  Boolean(m && canAccessModule(m) && m.permissions.includes(slug));

export const childrenOf = (modules: SessionModule[], rootCode: string): SessionModule[] =>
  modules.filter((m) => m.parentCode === rootCode).sort((a, b) => a.orderList - b.orderList);

export const roots = (modules: SessionModule[]): SessionModule[] =>
  modules.filter((m) => m.parentCode === null).sort((a, b) => a.orderList - b.orderList);

export function isOffline(modules: SessionModule[], m: SessionModule): boolean {
  if (m.isOffline) return true;
  const parent = m.parentCode ? modules.find((p) => p.code === m.parentCode) : undefined;
  return Boolean(parent?.isOffline);
}

/** Hojas a las que el usuario puede entrar dentro de una raíz */
export const accessibleChildren = (modules: SessionModule[], rootCode: string): SessionModule[] =>
  childrenOf(modules, rootCode).filter(canAccessModule);

export interface RootCard {
  module: SessionModule;
  enabled: boolean;
  offline: boolean;
}

/** Raíces que el usuario ve en el tablero/sidebar (excluye el propio Tablero) */
export function visibleRoots(modules: SessionModule[]): RootCard[] {
  return roots(modules)
    .filter((r) => r.code !== "DASHBOARD")
    .map((r) => {
      const kids = accessibleChildren(modules, r.code);
      const live = kids.filter((k) => !isOffline(modules, k));
      return { module: r, enabled: live.length > 0, offline: kids.length > 0 && live.length === 0 };
    })
    .filter((c) => c.enabled || c.offline);
}

/** Módulo cuyo `path` coincide con la URL (o es su prefijo más largo) */
export function moduleForPath(modules: SessionModule[], pathname: string): SessionModule | undefined {
  const clean = pathname.replace(/\/$/, "") || "/";
  return modules
    .filter((m) => clean === m.path || clean.startsWith(`${m.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
