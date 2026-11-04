/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/components/AutoRatesPanel.tsx
 * @description Tasas automáticas (fase 16): fuente oficial del país, activación, «Actualizar ahora»,
 * token del BCCR y bitácora de las últimas consultas
 */

import { useState } from "react";
import { Alert, Badge, Button, Group, Paper, PasswordInput, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconKey, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "../../services/settings.service";
import type { RateRun } from "../../types";

const STATUS: Record<RateRun["status"], { label: string; color: string }> = {
  running: { label: "En curso", color: "blue" },
  ok: { label: "Correcta", color: "teal" },
  partial: { label: "Parcial", color: "orange" },
  error: { label: "Falló", color: "red" }
};

const ACTION: Record<RateRun["rates"][number]["action"], string> = {
  inserted: "nueva",
  updated: "actualizada",
  unchanged: "sin cambio",
  kept_manual: "se mantuvo la manual",
  reference: "referencial (sin tasa oficial)"
};

export default function AutoRatesPanel({ baseCode }: Readonly<{ baseCode: string }>) {
  const qc = useQueryClient();
  const can = useCan("SET_COMMERCIAL");
  const canParams = useCan("SET_PARAMETERS");
  const [token, setToken] = useState("");
  const status = useQuery({ queryKey: ["settings", "exchange-rates"], queryFn: settingsApi.ratesStatus });
  const params = useQuery({ queryKey: ["settings", "parameters"], queryFn: settingsApi.listParameters, enabled: canParams("edit") });
  const autoParam = params.data?.find((p) => p.moduleCode === "SETTINGS" && p.key === "rates_auto_enabled");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["settings", "exchange-rates"] });
    qc.invalidateQueries({ queryKey: ["settings", "rates"] });
  };

  const run = useMutation({
    mutationFn: settingsApi.runRates,
    onSuccess: (r) => {
      if (r.status === "error") notifyError(new Error(r.message ?? "La consulta falló"));
      else notifySuccess(`Tasas consultadas: ${r.rates.filter((x) => x.action === "inserted" || x.action === "updated").length} registradas`);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => settingsApi.updateParameter(autoParam!.id, on),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "parameters"] });
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const saveToken = useMutation({
    mutationFn: () => settingsApi.saveBccrToken(token.trim()),
    onSuccess: () => {
      notifySuccess("Token guardado (cifrado)");
      setToken("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const removeToken = useMutation({ mutationFn: settingsApi.deleteBccrToken, onSuccess: refresh, onError: (err) => notifyError(err) });

  const s = status.data;
  if (!s) return null;
  if (!s.provider) {
    return (
      <Alert color="gray" variant="light" mb="md">
        El país de la empresa no tiene una fuente automática de tasas: regístrelas a mano en cada moneda.
      </Alert>
    );
  }
  const last = s.runs[0];

  return (
    <Paper withBorder radius="lg" p="md" mb="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={5}>Tasas automáticas · {s.provider.code}</Title>
          <Text size="sm" c="dimmed">
            {s.provider.name}. Se registra con la fecha valor que publica la fuente, en {baseCode}; una tasa cargada a mano no se reemplaza.
          </Text>
        </div>
        {can("edit") && (
          <Button leftSection={<IconRefresh size={16} />} loading={run.isPending} onClick={() => run.mutate()} disabled={s.provider.needsToken && !s.token?.configured}>
            Actualizar ahora
          </Button>
        )}
      </Group>

      <Stack gap="sm" mt="md">
        <Switch
          label={`Consultar automáticamente cada ${s.intervalHours} h`}
          description={canParams("edit") ? "Parámetro «Actualizar tasas de cambio automáticamente»" : "Se cambia en Parámetros"}
          checked={s.autoEnabled}
          disabled={!autoParam || toggle.isPending}
          onChange={(e) => toggle.mutate(e.currentTarget.checked)}
        />

        {s.provider.needsToken && (
          <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-body)">
            <Group gap="xs" mb={4}>
              <IconKey size={16} />
              <Text size="sm" fw={600}>
                Token del BCCR
              </Text>
              {s.token?.configured ? (
                <Badge size="sm" color="teal" variant="light">
                  cargado {s.token.hint}
                </Badge>
              ) : (
                <Badge size="sm" color="orange" variant="light">
                  falta
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" mb="xs">
              Regístrese en el sitio de Indicadores Económicos del BCCR (Mi perfil → Generar token) y péguelo aquí. Se guarda cifrado y
              no se vuelve a mostrar.
            </Text>
            {can("edit") && (
              <Group align="flex-end">
                <PasswordInput
                  className="flex-1"
                  placeholder={s.token?.configured ? "Pegar un token nuevo para reemplazarlo" : "Pegar el token"}
                  value={token}
                  onChange={(e) => setToken(e.currentTarget.value)}
                />
                <Button onClick={() => saveToken.mutate()} loading={saveToken.isPending} disabled={token.trim().length < 20}>
                  Guardar
                </Button>
                {s.token?.configured && (
                  <Button variant="subtle" color="red" onClick={() => removeToken.mutate()} loading={removeToken.isPending}>
                    Quitar
                  </Button>
                )}
              </Group>
            )}
          </Paper>
        )}

        {last?.status === "error" && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
            Última consulta ({fmtDateTime(last.startedAt)}): {last.message}
          </Alert>
        )}

        {s.runs.length > 0 && (
          <Table withTableBorder fz="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Consulta</Table.Th>
                <Table.Th>Resultado</Table.Th>
                <Table.Th>Tasas</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.runs.slice(0, 5).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="sm">{fmtDateTime(r.startedAt)}</Text>
                    <Text size="xs" c="dimmed">
                      {r.trigger === "schedule" ? "Programada" : `Manual · ${r.createdBy ?? "—"}`}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={STATUS[r.status].color}>
                      {STATUS[r.status].label}
                    </Badge>
                    {r.message && r.status !== "error" && (
                      <Text size="xs" c="dimmed">
                        {r.message}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.rates
                      .filter((x) => x.action !== "unchanged")
                      .slice(-4)
                      .map((x) => (
                        <Text key={`${x.currency}${x.rateDate}`} size="xs">
                          {x.currency} {dayjs(x.rateDate).format("DD/MM")}: {fmtMoney(x.rate, 4)} ({ACTION[x.action]})
                        </Text>
                      ))}
                    {r.rates.length > 0 && r.rates.every((x) => x.action === "unchanged") && (
                      <Text size="xs" c="dimmed">
                        Sin cambios
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}
