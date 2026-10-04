/**
 * @project FabriHub - API
 * @file src/security/context.ts
 * @description Tipos de contexto de seguridad que viajan en cada Request
 */

import type { Request } from "express";
import type { TxContext } from "../db.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Trace id de la petición (x-trace-id) */
      traceId: string;
      /** Sesión autenticada (lo fija authenticate) */
      auth?: AuthContext;
      /** Permisos efectivos sobre el módulo de la ruta (lo fija requirePermission) */
      modulePermissions?: string[];
    }
  }
}

/** Datos del cliente para bitácoras */
export const clientInfo = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 500) ?? null
});

/** Contexto de auditoría para withTx() */
export const txCtx = (req: Request): TxContext => ({ userId: req.auth?.userId ?? null, traceId: req.traceId });

/** Usuario autenticado (lanza si la ruta olvidó `authenticate`) */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new Error("authOf() llamado en una ruta sin authenticate");
  return req.auth;
}
