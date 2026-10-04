/**
 * @project FabriHub - Front
 * @file src/app/auth/change-password/ChangePasswordForm.tsx
 * @description Formulario de cambio de contraseña (primer ingreso y desde "Mi cuenta")
 */

import { useState, type FormEvent } from "react";
import { Alert, Button, PasswordInput, Stack } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { ApiError } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import { changePasswordRequest } from "@auth/services/auth.service";
import PasswordChecklist from "@auth/atoms/PasswordChecklist";
import { passwordIsValid } from "@utils/passwordRules";

export default function ChangePasswordForm({ onDone, submitLabel = "Cambiar contraseña" }: Readonly<{ onDone: () => void; submitLabel?: string }>) {
  const email = coreAuth((s) => s.user?.email);
  const setSession = coreAuth((s) => s.setSession);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && passwordIsValid(next, email) && confirm === next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const session = await changePasswordRequest(current, next);
      setSession(session);
      onDone();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const details = Array.isArray(apiErr?.details) ? ` ${(apiErr.details as string[]).join(". ")}` : "";
      setError((apiErr?.message ?? "No se pudo cambiar la contraseña") + details);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
            {error}
          </Alert>
        )}
        <PasswordInput label="Contraseña actual" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.currentTarget.value)} />
        <PasswordInput label="Nueva contraseña" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.currentTarget.value)} />
        <PasswordChecklist password={next} email={email} />
        <PasswordInput
          label="Confirmar nueva contraseña"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          error={mismatch ? "No coincide con la nueva contraseña" : null}
        />
        <Button type="submit" fullWidth loading={loading} disabled={!valid}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  );
}
