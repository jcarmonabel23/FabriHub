/**
 * @project FabriHub - Front
 * @file src/layouts/DashboardLayout.tsx
 * @description Layout autenticado: header + sidebar (salvo en el tablero) + contenido
 *
 * Aquí viven los guardianes transversales: inactividad/latido de sesión y métricas de visita.
 */

import { Button, Group, Modal, Text } from "@mantine/core";
import { Outlet, useLocation } from "react-router-dom";
import ModulesSidebar from "@atoms/layouts/ModulesSidebar";
import AppVersion from "@atoms/version/AppVersion";
import { signOut } from "@auth/logout/logout.service";
import { useTrackModuleVisit } from "@modules/metrics/useTrackModuleVisit";
import { useSessionGuard } from "@modules/session/useSessionGuard";
import HeaderMain from "./components/HeaderMain";

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const { warning, secondsLeft, stayConnected } = useSessionGuard();
  useTrackModuleVisit();

  const showSidebar = pathname !== "/dashboard";

  return (
    <div className="h-dvh flex flex-col">
      <HeaderMain />
      <div className="flex flex-1 min-h-0">
        {showSidebar && <ModulesSidebar />}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <AppVersion />

      <Modal opened={warning} onClose={stayConnected} title="¿Sigue ahí?" withCloseButton={false} closeOnClickOutside={false}>
        <Text size="sm">
          Por seguridad, su sesión se cerrará por inactividad en <b>{secondsLeft} s</b>.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => signOut()}>
            Cerrar sesión
          </Button>
          <Button onClick={stayConnected}>Seguir conectado</Button>
        </Group>
      </Modal>
    </div>
  );
}
