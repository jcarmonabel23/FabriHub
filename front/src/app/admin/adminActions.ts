/**
 * @project FabriHub - Front
 * @file src/app/admin/adminActions.ts
 * @description Navegación entre pantallas de Seguridad (botones del ModuleHeader, filtrados por acceso)
 */

import { IconApps, IconHistory, IconIdBadge2, IconUsers } from "@tabler/icons-react";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";

export const ADMIN_ACTIONS: HeaderAction[] = [
  { id: "users", label: "Usuarios", path: "/admin/users", icon: IconUsers, requiredCode: "ADM_USERS" },
  { id: "roles", label: "Roles", path: "/admin/roles", icon: IconIdBadge2, requiredCode: "ADM_ROLES" },
  { id: "modules", label: "Módulos", path: "/admin/modules", icon: IconApps, requiredCode: "ADM_MODULES" },
  { id: "audit", label: "Auditoría", path: "/admin/audit", icon: IconHistory, requiredCode: "ADM_AUDIT" }
];

/** Nombres legibles de los slugs (el catálogo trae `name`, esto es para chips compactos) */
export const PERMISSION_LABEL: Record<string, string> = {
  access: "Acceso",
  view: "Ver",
  view_all: "Ver todo",
  add_new: "Agregar",
  edit: "Editar",
  delete: "Eliminar",
  download: "Descargar",
  import: "Importar",
  approve: "Aprobar",
  release: "Liberar",
  close: "Cerrar",
  configure: "Configurar"
};
