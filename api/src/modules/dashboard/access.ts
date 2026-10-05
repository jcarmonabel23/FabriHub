/**
 * @project FabriHub - API
 * @file src/modules/dashboard/access.ts
 * @description Permisos efectivos de un usuario en TODOS los módulos y alcance de datos por almacén
 *
 * @overview
 * El Tablero junta información de varios módulos. Cada bloque (indicador, alerta, reporte) se
 * entrega solo si el usuario puede VER el módulo de origen, con la misma regla de requirePermission:
 * módulo activo, visible en el entorno, en servicio, con `access` + `view`. Sin `view_all` se
 * acota a sus almacenes (inventario) o a sus documentos (ventas), igual que en cada pantalla.
 */

import { query } from "../../db.js";
import { ENV_COLUMN } from "../../security/authorize.js";

export interface ModuleAccess {
  /** Slugs efectivos del usuario en cada módulo que puede ver */
  perms: Map<string, string[]>;
  /** Almacenes asignados (para quien no tiene view_all) */
  warehouses: string[];
}

export async function moduleAccess(userId: string): Promise<ModuleAccess> {
  const [rows, wh] = await Promise.all([
    query<{ code: string; permissions: string[] }>(
      `SELECT m.code, ep.permissions
         FROM v_users_effective_permissions ep
         JOIN catalogs_modules m ON m.id = ep.module_id
         JOIN catalogs_modules p ON p.id = m.module_parent_id
        WHERE ep.user_id = $1 AND m.is_active AND NOT m.is_offline AND m.${ENV_COLUMN}
          AND p.is_active AND NOT p.is_offline AND p.${ENV_COLUMN}
          AND ep.permissions ? 'access'`,
      [userId]
    ),
    query<{ warehouse_id: string }>(`SELECT warehouse_id FROM users_warehouses WHERE user_id = $1`, [userId])
  ]);
  return { perms: new Map(rows.map((r) => [r.code, r.permissions])), warehouses: wh.map((w) => w.warehouse_id) };
}

export const canView = (a: ModuleAccess, code: string): boolean => Boolean(a.perms.get(code)?.includes("view"));
export const has = (a: ModuleAccess, code: string, slug: string): boolean => Boolean(a.perms.get(code)?.includes(slug));

/** null = todos los almacenes; arreglo = solo los asignados */
export const warehouseScopeOf = (a: ModuleAccess, code: string): string[] | null => (has(a, code, "view_all") ? null : a.warehouses);

/** null = todos los documentos; id = solo los creados por el usuario */
export const ownerScopeOf = (a: ModuleAccess, code: string, userId: string): string | null => (has(a, code, "view_all") ? null : userId);

/**
 * Condición SQL «el usuario $U puede ver la alerta `a`». La comparten la lista de alertas y el
 * cálculo de destinatarios, para que la campana nunca muestre algo que la pantalla escondería.
 * `$U` se reemplaza por el parámetro o la columna con el id del usuario.
 */
export const alertVisibleTo = (userRef: string): string => `EXISTS (
  SELECT 1 FROM v_users_effective_permissions ep
    JOIN catalogs_modules m ON m.id = ep.module_id
    JOIN catalogs_modules mp ON mp.id = m.module_parent_id
   WHERE ep.user_id = ${userRef} AND m.code = a.module_code
     AND m.is_active AND NOT m.is_offline AND m.${ENV_COLUMN} AND mp.is_active AND NOT mp.is_offline AND mp.${ENV_COLUMN}
     AND ep.permissions ? 'access' AND ep.permissions ? 'view'
     AND (ep.permissions ? 'view_all'
          OR (a.warehouse_id IS NULL AND a.owner_id IS NULL)
          OR a.owner_id = ${userRef}
          OR (a.warehouse_id IS NOT NULL AND EXISTS (SELECT 1 FROM users_warehouses uw WHERE uw.user_id = ${userRef} AND uw.warehouse_id = a.warehouse_id))))`;
