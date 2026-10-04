/**
 * @project FabriHub - API
 * @file src/modules/inventory/scope.ts
 * @description Alcance de datos por almacén (nivel 6 de seguridad del plan)
 *
 * @overview
 * Con el permiso `view_all` en el módulo de la ruta, el usuario ve todos los almacenes.
 * Sin él, solo los asignados en users_warehouses: así un almacenista de materia prima no ve
 * ni mueve el almacén de producto terminado. La regla la aplica el SERVIDOR en cada consulta;
 * el front solo recibe lo que ya está filtrado.
 */

import type { Request } from "express";
import { query } from "../../db.js";
import { forbidden } from "../../lib/http.js";
import { authOf } from "../../security/context.js";

/** null = sin restricción; arreglo = solo esos almacenes */
export async function warehouseScope(req: Request): Promise<string[] | null> {
  if (req.modulePermissions?.includes("view_all")) return null;
  const rows = await query<{ warehouse_id: string }>(
    `SELECT warehouse_id FROM users_warehouses WHERE user_id = $1`,
    [authOf(req).userId]
  );
  return rows.map((r) => r.warehouse_id);
}

export function assertInScope(scope: string[] | null, ...warehouseIds: (string | null | undefined)[]): void {
  if (scope === null) return;
  for (const id of warehouseIds) {
    if (id && !scope.includes(id)) {
      throw forbidden("OUT_OF_SCOPE", "No tiene asignado ese almacén");
    }
  }
}
