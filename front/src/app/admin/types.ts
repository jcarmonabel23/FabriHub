/**
 * @project FabriHub - Front
 * @file src/app/admin/types.ts
 * @description Modelos del módulo de Seguridad
 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRow {
  id: string;
  email: string;
  names: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  logins: number;
  createdAt: string;
  modulesCount: number;
  activeSessions: number;
}

export interface Assignment {
  moduleCode: string;
  moduleName: string;
  roleIds: string[];
  permissions: string[];
  effective: string[] | null;
}

export interface UserDetail extends Omit<UserRow, "modulesCount" | "activeSessions"> {
  failedAttempts: number;
  passwordChangedAt: string | null;
  updatedAt: string;
  assignments: Assignment[];
  /** Alcance de datos: almacenes que ve y mueve sin el permiso view_all */
  warehouses: { id: string; code: string; name: string }[];
}

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  permissions: string[];
  isActive: boolean;
  isSystem: boolean;
  orderList: number;
  usersCount: number;
}

export interface Permission {
  slug: string;
  name: string;
  description: string | null;
}

export interface Lookups {
  roles: Pick<Role, "id" | "slug" | "name" | "description" | "permissions">[];
  modules: { code: string; name: string; isOffline: boolean; parentCode: string; parentName: string }[];
  permissions: Permission[];
}

export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  rotations: number;
}

export interface AdminModule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  path: string;
  orderList: number;
  parentCode: string | null;
  isPublic: boolean;
  isOffline: boolean;
  isShowDev: boolean;
  isShowQa: boolean;
  isShowProd: boolean;
  metadata: { phase?: number };
  usersCount: number;
}

export interface DataAuditRow {
  id: number;
  tableName: string;
  recordId: string | null;
  action: "I" | "U" | "D";
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedFields: string[] | null;
  traceId: string | null;
  createdAt: string;
  userId: string | null;
  userNames: string | null;
  userEmail: string | null;
}

export interface AuthAuditRow {
  id: number;
  userId: string | null;
  email: string | null;
  eventType: string;
  success: boolean;
  detail: Record<string, unknown>;
  traceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
