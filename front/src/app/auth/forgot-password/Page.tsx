/**
 * @project FabriHub - Front
 * @file src/app/auth/forgot-password/Page.tsx
 * @description Solicitud de código para restablecer la contraseña
 *
 * La respuesta es la misma exista o no la cuenta (no se puede usar para averiguar correos).
 */

import { useState, type FormEvent } from "react";
import { Alert, Anchor, Button, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconMail } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@clients/apiClient";
import { useAuthHeader } from "@auth/context/AuthHeaderContext";
import { forgotPasswordRequest } from "@auth/services/auth.service";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useAuthHeader({ title: "Restablecer contraseña", description: "Le enviaremos un código a su correo" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const clean = email.trim().toLowerCase();
      await forgotPasswordRequest(clean);
      navigate(`/auth/reset-password?email=${encodeURIComponent(clean)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar la solicitud");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8" noValidate>
      <Stack gap="lg">
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
            {error}
          </Alert>
        )}
        <TextInput
          label="Correo electrónico"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          leftSection={<IconMail size={18} stroke={1.5} color="var(--mantine-color-gray-6)" />}
        />
        <Button type="submit" fullWidth loading={loading} disabled={!email.includes("@")}>
          Enviar código
        </Button>
        <Text size="sm" c="dimmed" ta="center">
          <Anchor component="button" type="button" size="sm" fw={600} c="petrol.7" onClick={() => navigate("/auth/sign-in")}>
            Volver a iniciar sesión
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
