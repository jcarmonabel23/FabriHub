/**
 * @project FabriHub - Front
 * @file src/app/auth/reset-password/Page.tsx
 * @description Restablecer contraseña con el código recibido por correo
 */

import { useState, type FormEvent } from "react";
import { Alert, Anchor, Button, Center, PasswordInput, PinInput, Stack, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@clients/apiClient";
import { useAuthHeader } from "@auth/context/AuthHeaderContext";
import { resetPasswordRequest } from "@auth/services/auth.service";
import PasswordChecklist from "@auth/atoms/PasswordChecklist";
import { passwordIsValid } from "@utils/passwordRules";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useAuthHeader({ title: "Nueva contraseña", description: "Ingrese el código recibido y su nueva contraseña" });

  const valid = email.includes("@") && code.length === 6 && passwordIsValid(password, email) && password === confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      await resetPasswordRequest(email.trim().toLowerCase(), code, password);
      navigate("/auth/sign-in?reason=PASSWORD_RESET", { replace: true });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const details = Array.isArray(apiErr?.details) ? ` ${(apiErr.details as string[]).join(". ")}` : "";
      setError((apiErr?.message ?? "No se pudo restablecer la contraseña") + details);
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8" noValidate>
      <Stack gap="md">
        <Alert color="petrol" variant="light" icon={<IconMailCheck size={18} />}>
          Si el correo está registrado, recibió un código de 6 dígitos válido por pocos minutos.
        </Alert>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
            {error}
          </Alert>
        )}
        <TextInput label="Correo electrónico" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <div>
          <Text size="sm" fw={500} mb={6}>
            Código
          </Text>
          <Center>
            <PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} aria-label="Código" />
          </Center>
        </div>
        <PasswordInput label="Nueva contraseña" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <PasswordChecklist password={password} email={email} />
        <PasswordInput
          label="Confirmar contraseña"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          error={confirm && confirm !== password ? "No coincide" : null}
        />
        <Button type="submit" fullWidth loading={loading} disabled={!valid}>
          Restablecer contraseña
        </Button>
        <Text size="sm" c="dimmed" ta="center">
          <Anchor component="button" type="button" size="sm" fw={600} c="petrol.7" onClick={() => navigate("/auth/forgot-password")}>
            Pedir otro código
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
