/**
 * @project FabriHub - Front
 * @file src/navigation/ProtectedRoute.tsx
 * @description Exige sesión. Mientras se restaura muestra un loader; con cambio de contraseña
 * pendiente solo deja ir a la pantalla de cambio (la API aplica la misma regla).
 */

import { Center, Loader, Stack, Text } from "@mantine/core";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { CHANGE_PASSWORD_REQUIRED, DEFAULT_REDIRECT_UNAUTHENTICATED } from "./routes.config";

export function ProtectedRoute() {
  const status = coreAuth((s) => s.status);
  const isAuthenticated = coreAuth((s) => s.isAuthenticated);
  const mustChange = coreAuth((s) => s.user?.mustChangePassword);
  const location = useLocation();

  if (status === "restoring" || (isAuthenticated && status === "anonymous")) {
    return (
      <Center h="100dvh">
        <Stack align="center" gap="xs">
          <Loader />
          <Text size="sm" c="dimmed">
            Restaurando su sesión…
          </Text>
        </Stack>
      </Center>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to={DEFAULT_REDIRECT_UNAUTHENTICATED} state={{ from: location }} replace />;
  }

  if (mustChange) return <Navigate to={CHANGE_PASSWORD_REQUIRED} replace />;

  return <Outlet />;
}

/** Rutas de /auth: si ya hay sesión completa, no tiene sentido ver el login */
export function AuthRoute() {
  const status = coreAuth((s) => s.status);
  const mustChange = coreAuth((s) => s.user?.mustChangePassword);
  const { pathname } = useLocation();

  if (status === "authenticated") {
    if (mustChange && pathname !== CHANGE_PASSWORD_REQUIRED) return <Navigate to={CHANGE_PASSWORD_REQUIRED} replace />;
    if (!mustChange) return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
