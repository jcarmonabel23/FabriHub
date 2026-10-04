/**
 * @project FabriHub - Front
 * @file src/global/atoms/layouts/ModulesSidebar.tsx
 * @description Barra lateral de íconos de subsistemas (misma forma que en DaviHub)
 */

import { ScrollArea, Tooltip } from "@mantine/core";
import { IconHome } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { visibleRoots } from "@modules/access-control/moduleTree";
import { ModuleIcon } from "@modules/icons/moduleIcons";

const base = "p-2 rounded-xl transition-all duration-200 border";
const active = "bg-brand-50 text-brand-700 border-brand-100";
const idle = "bg-white text-gray-400 border-transparent hover:text-brand-700 hover:bg-brand-50";

export default function ModulesSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const modules = coreAuth((s) => s.modules);
  const cards = visibleRoots(modules).filter((c) => c.enabled);

  return (
    <aside className="w-[60px] h-full min-h-0 bg-white border-r border-gray-100 flex flex-col shadow-sm z-20 shrink-0">
      <ScrollArea className="flex-1 w-full" scrollbarSize={4} type="scroll">
        <nav className="flex flex-col items-center gap-6 py-6 w-full" aria-label="Módulos">
          <Tooltip label="Tablero" position="right">
            <button type="button" aria-label="Tablero" onClick={() => navigate("/dashboard")} className={`${base} ${pathname.startsWith("/dashboard") ? active : idle}`}>
              <IconHome size={24} stroke={1.6} />
            </button>
          </Tooltip>
          {cards.map(({ module }) => {
            const isActive = pathname === module.path || pathname.startsWith(`${module.path}/`);
            return (
              <Tooltip key={module.code} label={module.name} position="right">
                <button type="button" aria-label={module.name} onClick={() => navigate(module.path)} className={`${base} ${isActive ? active : idle}`}>
                  <ModuleIcon icon={module.icon} size={24} />
                </button>
              </Tooltip>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
