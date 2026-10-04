/**
 * @project FabriHub - Front
 * @file src/global/atoms/layouts/ModuleHeader.tsx
 * @description Encabezado de módulo (patrón DaviHub): logo + título + descripción + acciones de navegación
 *
 * Cada acción puede exigir `requiredCode`: si el usuario no puede entrar a ese módulo, el botón
 * no se pinta (misma regla que menú y rutas).
 */

import type { ComponentType, ReactNode } from "react";
import { Button } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "@atoms/brand/Logo";
import { useCanAccess, useModuleStatus } from "@modules/access-control/useCan";

export interface HeaderAction {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  requiredCode?: string;
}

interface ModuleHeaderProps {
  title: string;
  description: string;
  actions?: HeaderAction[];
  right?: ReactNode;
}

export default function ModuleHeader({ title, description, actions, right }: Readonly<ModuleHeaderProps>) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const canAccess = useCanAccess();
  const statusOf = useModuleStatus();

  const visible = (actions ?? []).filter(
    (a) => !a.requiredCode || (canAccess(a.requiredCode) && !statusOf(a.requiredCode).offline)
  );

  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        <LogoMark size={52} />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900 uppercase">{title}</h1>
          <p className="text-gray-500 text-sm">{description}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {visible.map(({ id, label, path, icon: Icon }) => {
          const isActive = pathname === path || pathname.startsWith(`${path}/`);
          return (
            <Button
              key={id}
              size="sm"
              variant={isActive ? "filled" : "light"}
              leftSection={<Icon size={16} stroke={1.8} />}
              onClick={() => navigate(path)}
            >
              {label}
            </Button>
          );
        })}
        {right}
      </div>
    </header>
  );
}
