/**
 * @project FabriHub - Front
 * @file src/app/pos/components/SupervisorFields.tsx
 * @description Autorización de un supervisor en la caja: quién autoriza y su clave
 *
 * Solo se muestra cuando quien opera la caja no es supervisor (permiso Aprobar en ventas de mostrador).
 * La clave la verifica el servidor; cinco fallos seguidos la bloquean 15 minutos.
 */

import { Group, PasswordInput, Select, Text } from "@mantine/core";
import { IconShieldLock } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { posApi } from "../services/pos.service";
import type { SupervisorInput } from "../types";

interface Props {
  value: SupervisorInput;
  onChange: (v: SupervisorInput) => void;
  reason: string;
  error?: string | null;
}

export default function SupervisorFields({ value, onChange, reason, error }: Readonly<Props>) {
  const sups = useQuery({ queryKey: ["pos", "supervisors"], queryFn: posApi.supervisors });
  const options = (sups.data ?? []).filter((s) => s.hasPin).map((s) => ({ value: s.id, label: s.names }));
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <Group gap={6} mb={6}>
        <IconShieldLock size={18} className="text-amber-700" />
        <Text size="sm" fw={600} c="orange.9">
          {reason}
        </Text>
      </Group>
      <Group grow align="flex-start">
        <Select
          label="Supervisor"
          placeholder={sups.isLoading ? "Cargando…" : options.length ? "Elija" : "Ningún supervisor tiene clave"}
          data={options}
          value={value.userId || null}
          onChange={(v) => onChange({ ...value, userId: v ?? "" })}
          comboboxProps={{ withinPortal: true }}
        />
        <PasswordInput
          label="Clave"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={value.pin}
          onChange={(e) => onChange({ ...value, pin: e.currentTarget.value.replace(/\D/g, "") })}
          error={error ?? null}
        />
      </Group>
    </div>
  );
}

export const supervisorReady = (s: SupervisorInput) => Boolean(s.userId) && /^\d{4,8}$/.test(s.pin);

/** Errores del servidor que se muestran junto a la clave en lugar de una notificación */
export const SUPERVISOR_ERRORS = ["SUPERVISOR_REQUIRED", "INVALID_SUPERVISOR", "SUPERVISOR_LOCKED"];
