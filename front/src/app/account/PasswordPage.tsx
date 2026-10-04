/**
 * @project FabriHub - Front
 * @file src/app/account/PasswordPage.tsx
 * @description Mi cuenta → Cambiar contraseña (voluntario). Cierra las demás sesiones del usuario.
 */

import { Paper, Text } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import ChangePasswordForm from "@auth/change-password/ChangePasswordForm";
import { notifySuccess } from "@utils/notify";

export default function PasswordPage() {
  const navigate = useNavigate();
  return (
    <div className="p-6">
      <ModuleHeader title="Mi cuenta" description="Cambio de contraseña" />
      <Paper withBorder radius="lg" p="xl" maw={520}>
        <Text fw={600} mb={4} className="flex items-center gap-2">
          <IconKey size={18} /> Cambiar contraseña
        </Text>
        <Text size="sm" c="dimmed" mb="lg">
          Al cambiarla se cerrarán sus sesiones abiertas en otros equipos.
        </Text>
        <ChangePasswordForm
          onDone={() => {
            notifySuccess("Su contraseña fue actualizada y se cerraron sus otras sesiones");
            navigate("/dashboard");
          }}
        />
      </Paper>
    </div>
  );
}
