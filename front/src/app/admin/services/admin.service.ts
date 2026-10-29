/**
 * @project FabriHub - Front
 * @file src/app/admin/services/admin.service.ts
 * @description Llamadas a /admin/* (cada una autorizada por la API según módulo + permiso)
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@clients/apiClient";
import type {
  AdminModule,
  AuthAuditRow,
  CompanyInput,
  CompanyMember,
  CompanyRow,
  DataAuditRow,
  Lookups,
  Page,
  Permission,
  Role,
  Session,
  UserDetail,
  UserRow
} from "../types";

type Q = Record<string, string | number | boolean | null | undefined>;

export const adminApi = {
  // Usuarios
  listUsers: (q: Q) => apiGet<Page<UserRow>>("/admin/users", q),
  getUser: (id: string) => apiGet<UserDetail>(`/admin/users/${id}`),
  lookups: () => apiGet<Lookups>("/admin/users/lookups"),
  /** Si el correo ya existe en otra empresa, lo agrega a esta (addedExisting) */
  createUser: (body: { email: string; names: string }) => apiPost<UserDetail & { addedExisting: boolean }>("/admin/users", body),
  removeFromCompany: (id: string) => apiDelete<void>(`/admin/users/${id}/membership`),
  updateUser: (id: string, body: { names?: string; isActive?: boolean }) => apiPatch<UserDetail>(`/admin/users/${id}`, body),
  unlockUser: (id: string) => apiPost<UserDetail>(`/admin/users/${id}/unlock`),
  resetPassword: (id: string) => apiPost<{ message: string }>(`/admin/users/${id}/reset-password`),
  setModules: (id: string, assignments: { moduleCode: string; roleIds: string[]; permissions: string[] }[]) =>
    apiPut<UserDetail>(`/admin/users/${id}/modules`, { assignments }),
  setWarehouses: (id: string, warehouseIds: string[]) => apiPut<UserDetail>(`/admin/users/${id}/warehouses`, { warehouseIds }),
  sessions: (id: string) => apiGet<Session[]>(`/admin/users/${id}/sessions`),
  revokeSessions: (id: string) => apiDelete<void>(`/admin/users/${id}/sessions`),

  // Roles
  listRoles: () => apiGet<Role[]>("/admin/roles"),
  listPermissions: () => apiGet<Permission[]>("/admin/permissions"),
  createRole: (body: { slug: string; name: string; description?: string; permissions: string[] }) =>
    apiPost<Role>("/admin/roles", body),
  updateRole: (id: string, body: Partial<Pick<Role, "name" | "description" | "permissions" | "isActive">>) =>
    apiPatch<Role>(`/admin/roles/${id}`, body),
  deleteRole: (id: string) => apiDelete<void>(`/admin/roles/${id}`),

  // Módulos
  listModules: () => apiGet<AdminModule[]>("/admin/modules"),
  updateModule: (id: string, body: Partial<Pick<AdminModule, "isOffline" | "isShowDev" | "isShowQa" | "isShowProd">>) =>
    apiPatch<AdminModule>(`/admin/modules/${id}`, body),

  // Empresas (plataforma)
  listCompanies: () => apiGet<CompanyRow[]>("/admin/companies"),
  createCompany: (body: CompanyInput) => apiPost<CompanyRow>("/admin/companies", body),
  updateCompany: (id: string, body: Partial<Omit<CompanyInput, "code" | "templateCompanyId" | "admin">> & { isActive?: boolean }) =>
    apiPatch<CompanyRow>(`/admin/companies/${id}`, body),
  companyMembers: (id: string) => apiGet<CompanyMember[]>(`/admin/companies/${id}/members`),
  addCompanyMember: (id: string, body: { email: string; names?: string; asAdmin: boolean }) =>
    apiPost<{ userId: string; created: boolean }>(`/admin/companies/${id}/members`, body),
  removeCompanyMember: (id: string, userId: string) => apiDelete<void>(`/admin/companies/${id}/members/${userId}`),

  // Auditoría
  dataAudit: (q: Q) => apiGet<Page<DataAuditRow>>("/admin/audit/data", q),
  auditTables: () => apiGet<string[]>("/admin/audit/tables"),
  authAudit: (q: Q) => apiGet<Page<AuthAuditRow>>("/admin/audit/auth", q)
};
