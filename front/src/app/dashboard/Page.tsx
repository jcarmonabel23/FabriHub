/**
 * @project FabriHub - Front
 * @file src/app/dashboard/Page.tsx
 * @description Tablero: subsistemas a los que el usuario puede entrar (regla única de moduleTree)
 *
 * Las raíces cuyas pantallas están todas fuera de servicio se muestran deshabilitadas con
 * "Próximamente": así el tablero también cuenta el plan por fases de la tesis.
 * Arriba, los accesos a las pantallas propias del Tablero (Indicadores, Alertas, Reportes) que el
 * usuario tenga asignadas; al lado, sus avisos.
 */

import { Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { ModuleIcon } from "@modules/icons/moduleIcons";
import { accessibleChildren, isOffline, visibleRoots } from "@modules/access-control/moduleTree";
import DashboardGridButtons from "./atoms/DashboardGridButtons";
import DashboardAlerts from "./components/DashboardAlerts";
import DashboardUser from "./components/DashboardUser";

export default function DashboardPage() {
  const navigate = useNavigate();
  const modules = coreAuth((s) => s.modules);
  const cards = visibleRoots(modules);
  const own = accessibleChildren(modules, "DASHBOARD").filter((m) => !isOffline(modules, m));

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      <div className="flex-1 space-y-6">
        {own.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {own.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => navigate(m.path)}
                className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 bg-white text-left shadow-sm transition-all hover:border-brand-200 hover:shadow-md group"
              >
                <div className="w-12 h-12 shrink-0 rounded-xl flex items-center justify-center bg-brand-50 text-brand-700 group-hover:bg-brand-700 group-hover:text-white transition-colors">
                  <ModuleIcon icon={m.icon} size={24} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 uppercase tracking-tight">{m.name}</p>
                  <p className="text-xs text-gray-500 line-clamp-2">{m.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="bg-white border-2 border-dashed border-brand-100 rounded-2xl p-6 lg:p-8">
          <header className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900">Panel de Control - FabriHub</h2>
            <p className="text-gray-500 mt-1">Selecciona el módulo al que deseas acceder</p>
          </header>

          {cards.length === 0 ? (
            <Text ta="center" c="dimmed" py="xl">
              Aún no tiene módulos asignados. Solicite acceso al administrador.
            </Text>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {cards.map(({ module, enabled }) => (
                <DashboardGridButtons
                  key={module.code}
                  name={module.name}
                  description={module.description}
                  icon={module.icon}
                  enabled={enabled}
                  badge={enabled ? undefined : "Próximamente"}
                  onClick={() => navigate(module.path)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <aside className="w-full lg:w-80 space-y-6">
        <DashboardAlerts />
        <DashboardUser />
      </aside>
    </div>
  );
}
