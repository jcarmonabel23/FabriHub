/**
 * @project FabriHub - Front
 * @file src/app/hub/ModuleHubPage.tsx
 * @description Hub genérico de un subsistema: tarjetas de sus pantallas accesibles
 */

import { useNavigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { coreAuth } from "@auth/store/coreAuth";
import DashboardGridButtons from "@dashboard/atoms/DashboardGridButtons";
import { accessibleChildren, isOffline } from "@modules/access-control/moduleTree";

export default function ModuleHubPage({ rootCode }: Readonly<{ rootCode: string }>) {
  const navigate = useNavigate();
  const modules = coreAuth((s) => s.modules);
  const root = modules.find((m) => m.code === rootCode);
  const kids = accessibleChildren(modules, rootCode);

  if (!root) return null;

  return (
    <div className="p-6">
      <ModuleHeader title={root.name} description={root.description ?? ""} />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {kids.map((m) => {
          const off = isOffline(modules, m);
          return (
            <DashboardGridButtons
              key={m.code}
              name={m.name}
              description={m.description}
              icon={m.icon}
              enabled={!off}
              badge={off ? "Fuera de servicio" : undefined}
              onClick={() => navigate(m.path)}
            />
          );
        })}
      </div>
    </div>
  );
}
