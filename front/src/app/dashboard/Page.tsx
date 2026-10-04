/**
 * @project FabriHub - Front
 * @file src/app/dashboard/Page.tsx
 * @description Tablero: subsistemas a los que el usuario puede entrar (regla única de moduleTree)
 *
 * Las raíces cuyas pantallas están todas fuera de servicio se muestran deshabilitadas con
 * "Próximamente": así el tablero también cuenta el plan por fases de la tesis.
 */

import { Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { visibleRoots } from "@modules/access-control/moduleTree";
import DashboardGridButtons from "./atoms/DashboardGridButtons";
import DashboardUser from "./components/DashboardUser";

export default function DashboardPage() {
  const navigate = useNavigate();
  const modules = coreAuth((s) => s.modules);
  const cards = visibleRoots(modules);

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      <div className="flex-1">
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
        <DashboardUser />
      </aside>
    </div>
  );
}
