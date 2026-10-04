/**
 * @project FabriHub - Front
 * @file src/app/auth/change-password/Page.tsx
 * @description Cambio OBLIGATORIO de contraseña (primer ingreso o reinicio por el administrador)
 */

import { Alert, Anchor, Stack, Text } from "@mantine/core";
import { IconShieldLock } from "@tabler/icons-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthHeader } from "@auth/context/AuthHeaderContext";
import { coreAuth } from "@auth/store/coreAuth";
import { signOut } from "@auth/logout/logout.service";
import { DEFAULT_REDIRECT_AUTHENTICATED } from "@navigation/routes.config";
import ChangePasswordForm from "./ChangePasswordForm";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const status = coreAuth((s) => s.status);
  const user = coreAuth((s) => s.user);

  useAuthHeader({ title: "Cambie su contraseña", description: "Por seguridad, defina una contraseña personal antes de continuar" });

  if (status !== "authenticated" || !user) return <Navigate to="/auth/sign-in" replace />;
  if (!user.mustChangePassword) return <Navigate to={DEFAULT_REDIRECT_AUTHENTICATED} replace />;

  return (
    <Stack gap="lg" className="mt-8">
      <Alert color="petrol" variant="light" icon={<IconShieldLock size={18} />}>
        Está usando una contraseña temporal. Hasta cambiarla no podrá usar ningún módulo.
      </Alert>
      <ChangePasswordForm submitLabel="Guardar y continuar" onDone={() => navigate(DEFAULT_REDIRECT_AUTHENTICATED, { replace: true })} />
      <Text size="sm" c="dimmed" ta="center">
        <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => signOut()}>
          Cerrar sesión
        </Anchor>
      </Text>
    </Stack>
  );
}
