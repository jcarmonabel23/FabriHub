/**
 * @project FabriHub - Front
 * @file src/app/auth/sign-in/Page.tsx
 * @description Inicio de sesión (paso 1 de 2)
 *
 * No hay registro público: las cuentas las crea un administrador (Seguridad → Usuarios).
 */

import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput, rem } from "@mantine/core";
import { IconAlertCircle, IconInfoCircle, IconLock, IconMail } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { useAuthHeader } from "@auth/context/AuthHeaderContext";
import { useSignInLogic } from "./hooks/useSignInLogic";

/** Motivos con los que la app devuelve al login */
const REASONS: Record<string, string> = {
  SESSION_IDLE: "Su sesión se cerró por inactividad.",
  SESSION_REVOKED: "Su sesión fue cerrada (cambio de contraseña, administrador o inicio en otro equipo).",
  REFRESH_REUSED: "Por seguridad cerramos todas sus sesiones. Si no fue usted, cambie su contraseña.",
  REFRESH_INVALID: "Su sesión expiró. Inicie sesión de nuevo.",
  SESSION_EXPIRED: "Su sesión expiró. Inicie sesión de nuevo.",
  PASSWORD_RESET: "Contraseña actualizada. Ya puede iniciar sesión."
};

const iconStyle = { width: rem(18), height: rem(18) };

export default function SignInPage() {
  const { email, setEmail, password, setPassword, emailError, formError, isLoading, handleSubmit, navigate } =
    useSignInLogic();
  const [params] = useSearchParams();
  const reason = params.get("reason");

  useAuthHeader({ title: "Bienvenido", description: "Ingrese sus credenciales para continuar" });

  return (
    <form className="mt-8" onSubmit={handleSubmit} noValidate>
      <Stack gap="lg">
        {reason && REASONS[reason] && !formError && (
          <Alert color={reason === "PASSWORD_RESET" ? "teal" : "yellow"} icon={<IconInfoCircle size={18} />} variant="light">
            {REASONS[reason]}
          </Alert>
        )}
        {formError && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
            {formError}
          </Alert>
        )}

        <TextInput
          label="Correo electrónico"
          placeholder="usuario@empresa.com"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          error={emailError}
          leftSection={<IconMail style={iconStyle} stroke={1.5} color="var(--mantine-color-gray-6)" />}
        />

        <PasswordInput
          label="Contraseña"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          leftSection={<IconLock style={iconStyle} stroke={1.5} color="var(--mantine-color-gray-6)" />}
        />

        <Button type="submit" fullWidth loading={isLoading} disabled={!email || !password} className="mt-2">
          Iniciar sesión
        </Button>

        <Text size="sm" c="dimmed" ta="center">
          ¿Olvidó su contraseña?{" "}
          <Anchor component="button" type="button" size="sm" fw={600} c="petrol.7" onClick={() => navigate("/auth/forgot-password")}>
            Restablecer
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
