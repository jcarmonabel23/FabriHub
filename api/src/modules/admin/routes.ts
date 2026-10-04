/**
 * @project FabriHub - API
 * @file src/modules/admin/routes.ts
 * @description Rutas de Seguridad (/api/v1/admin). Cada ruta declara módulo + permiso exigido.
 */

import { Router } from "express";
import { requirePermission as can } from "../../security/authorize.js";
import { AUDIT_MODULE, listAuditTables, listAuthAudit, listDataAudit } from "./audit.js";
import { MODULES_MODULE, listModules, updateModule } from "./modules.js";
import { ROLES_MODULE, createRole, deleteRole, listPermissions, listRoles, updateRole } from "./roles.js";
import {
  USERS_MODULE,
  adminResetPassword,
  createUser,
  getUser,
  listSessions,
  listUsers,
  revokeSessions,
  setUserModules,
  setUserWarehouses,
  unlockUser,
  updateUser,
  userLookups
} from "./users.js";

export const adminRoutes = Router();

// Usuarios
adminRoutes.get("/users", can(USERS_MODULE, "view"), listUsers);
adminRoutes.get("/users/lookups", can(USERS_MODULE, "configure"), userLookups);
adminRoutes.get("/users/:id", can(USERS_MODULE, "view"), getUser);
adminRoutes.post("/users", can(USERS_MODULE, "add_new"), createUser);
adminRoutes.patch("/users/:id", can(USERS_MODULE, "edit"), updateUser);
adminRoutes.post("/users/:id/unlock", can(USERS_MODULE, "configure"), unlockUser);
adminRoutes.post("/users/:id/reset-password", can(USERS_MODULE, "configure"), adminResetPassword);
adminRoutes.put("/users/:id/modules", can(USERS_MODULE, "configure"), setUserModules);
adminRoutes.put("/users/:id/warehouses", can(USERS_MODULE, "configure"), setUserWarehouses);
adminRoutes.get("/users/:id/sessions", can(USERS_MODULE, "view"), listSessions);
adminRoutes.delete("/users/:id/sessions", can(USERS_MODULE, "configure"), revokeSessions);

// Roles y permisos
adminRoutes.get("/roles", can(ROLES_MODULE, "view"), listRoles);
adminRoutes.get("/permissions", can(ROLES_MODULE, "view"), listPermissions);
adminRoutes.post("/roles", can(ROLES_MODULE, "add_new"), createRole);
adminRoutes.patch("/roles/:id", can(ROLES_MODULE, "edit"), updateRole);
adminRoutes.delete("/roles/:id", can(ROLES_MODULE, "delete"), deleteRole);

// Módulos
adminRoutes.get("/modules", can(MODULES_MODULE, "view"), listModules);
adminRoutes.patch("/modules/:id", can(MODULES_MODULE, "configure"), updateModule);

// Auditoría
adminRoutes.get("/audit/data", can(AUDIT_MODULE, "view"), listDataAudit);
adminRoutes.get("/audit/tables", can(AUDIT_MODULE, "view"), listAuditTables);
adminRoutes.get("/audit/auth", can(AUDIT_MODULE, "view"), listAuthAudit);
