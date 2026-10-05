/**
 * @project FabriHub - API
 * @file src/security/authorize.ts
 * @description Autorización por módulo y permiso (RBAC modelo DaviHub), del lado del servidor
 *
 * @overview
 * El front oculta botones con `useCan`, pero quien AUTORIZA es la API: cada handler de
 * negocio se monta detrás de `requirePermission(MODULE_CODE, ...slugs)`.
 *
 * Reglas, en este orden:
 *  1. El módulo debe existir, estar activo y ser visible en este entorno (is_show_*). Si no,
 *     403 sin más explicación (no se revela que existe en otro entorno).
 *  2. Si está fuera de servicio (is_offline) → 503 MODULE_OFFLINE.
 *  3. El usuario debe tener `access` en el módulo y TODOS los slugs pedidos.
 *     Permisos efectivos = unión de roles activos + extras (vista v_users_effective_permissions).
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { config } from "../config.js";
import { one, query } from "../db.js";
import { HttpError, forbidden } from "../lib/http.js";

export const ENV_COLUMN = { dev: "is_show_dev", qa: "is_show_qa", prod: "is_show_prod" }[config.APP_ENVIRONMENT];

interface ModuleAccessRow {
  is_public: boolean;
  is_offline: boolean;
  visible: boolean;
  permissions: string[] | null;
}

export async function modulePermissions(userId: string, moduleCode: string): Promise<ModuleAccessRow | null> {
  return one<ModuleAccessRow>(
    `SELECT m.is_public, m.is_offline, m.${ENV_COLUMN} AS visible, ep.permissions
       FROM catalogs_modules m
       LEFT JOIN v_users_effective_permissions ep ON ep.module_id = m.id AND ep.user_id = $1
      WHERE m.code = $2 AND m.is_active`,
    [userId, moduleCode]
  );
}

export function requirePermission(moduleCode: string, ...slugs: string[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new Error(`requirePermission(${moduleCode}) sin authenticate previo`);

      const row = await modulePermissions(req.auth.userId, moduleCode);
      if (!row || !row.visible) throw forbidden();
      if (row.is_offline) throw new HttpError(503, "MODULE_OFFLINE", "El módulo está fuera de servicio");

      const granted = row.permissions ?? [];
      const hasAccess = row.is_public || granted.includes("access");
      const missing = slugs.filter((s) => !granted.includes(s));
      if (!hasAccess || missing.length > 0) throw forbidden();

      req.modulePermissions = granted;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Módulo tal como lo recibe el front en la sesión */
export interface SessionModule {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  path: string;
  parentCode: string | null;
  isPublic: boolean;
  isOffline: boolean;
  orderList: number;
  permissions: string[];
}

/**
 * @function sessionModules
 * @description Catálogo visible en este entorno + permisos efectivos del usuario en cada hoja.
 * Los módulos ocultos en el entorno no se envían (el front no debe saber que existen).
 */
export function sessionModules(userId: string): Promise<SessionModule[]> {
  return query<SessionModule>(
    `SELECT m.code, m.name, m.description, m.icon, m.path,
            p.code AS "parentCode", m.is_public AS "isPublic", m.is_offline AS "isOffline",
            m.order_list AS "orderList", COALESCE(ep.permissions, '[]'::jsonb) AS permissions
       FROM catalogs_modules m
       LEFT JOIN catalogs_modules p ON p.id = m.module_parent_id
       LEFT JOIN v_users_effective_permissions ep ON ep.module_id = m.id AND ep.user_id = $1
      WHERE m.is_active AND m.${ENV_COLUMN}
        AND (p.id IS NULL OR (p.is_active AND p.${ENV_COLUMN}))
      ORDER BY p.order_list NULLS FIRST, m.order_list`,
    [userId]
  );
}
