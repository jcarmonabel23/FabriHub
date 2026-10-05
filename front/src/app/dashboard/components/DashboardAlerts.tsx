/**
 * @project FabriHub - Front
 * @file src/app/dashboard/components/DashboardAlerts.tsx
 * @description Tarjeta lateral del tablero: avisos sin leer del usuario y, si ve Alertas, las abiertas por severidad
 */

import { Badge, Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBellRinging } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useCanAccess } from "@modules/access-control/useCan";
import { fmtRelative } from "@utils/format";
import { SEVERITY_COLOR, SEVERITY_LABEL, type Severity, dashboardApi } from "../dashboard.service";

export default function DashboardAlerts() {
  const navigate = useNavigate();
  const canAccess = useCanAccess();
  const qc = useQueryClient();
  const seesAlerts = canAccess("DSH_ALERTS");

  // Misma clave que la campana: comparten caché y refresco.
  const unread = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => dashboardApi.notifications(true), refetchInterval: 60_000 });
  const summary = useQuery({ queryKey: ["dashboard", "alerts-summary"], queryFn: dashboardApi.alertsSummary, enabled: seesAlerts });

  const items = unread.data?.items.slice(0, 4) ?? [];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <Group gap="xs" mb="md">
        <IconBellRinging size={20} className="text-brand-700" />
        <Text fw={700}>Avisos</Text>
        {(unread.data?.unread ?? 0) > 0 && (
          <Badge color="red" size="sm">
            {unread.data!.unread} sin leer
          </Badge>
        )}
      </Group>

      {seesAlerts && summary.data && (
        <Group gap={6} mb="md">
          {(["critical", "warning", "info"] as Severity[]).map((s) => (
            <Badge key={s} color={SEVERITY_COLOR[s]} variant={s === "critical" ? "filled" : "light"}>
              {summary.data.bySeverity[s]} {SEVERITY_LABEL[s].toLowerCase()}
              {summary.data.bySeverity[s] === 1 ? "" : "s"}
            </Badge>
          ))}
        </Group>
      )}

      <Stack gap={6}>
        {items.length === 0 && (
          <Text size="sm" c="dimmed">
            No tiene avisos pendientes.
          </Text>
        )}
        {items.map((n) => (
          <UnstyledButton
            key={n.id}
            className="rounded-md px-2 py-1.5 hover:bg-gray-50"
            onClick={async () => {
              await dashboardApi.markRead(n.id).catch(() => undefined);
              qc.invalidateQueries({ queryKey: ["notifications"] });
              if (n.link) navigate(n.link);
            }}
          >
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--mantine-color-${SEVERITY_COLOR[n.severity]}-6)` }} />
              <div className="min-w-0">
                <Text size="sm" fw={600} lineClamp={1}>
                  {n.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {fmtRelative(n.createdAt)}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>

      {seesAlerts && (
        <Button fullWidth variant="light" mt="md" onClick={() => navigate("/dashboard/alerts")}>
          Ver todas las alertas
        </Button>
      )}
    </div>
  );
}
