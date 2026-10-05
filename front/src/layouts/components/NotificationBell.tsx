/**
 * @project FabriHub - Front
 * @file src/layouts/components/NotificationBell.tsx
 * @description Campana del header: avisos del detector de alertas para el usuario de la sesión
 *
 * Consulta cada minuto. Al abrir un aviso lo marca leído y navega a la pantalla donde se atiende.
 * Lo que llega aquí ya viene filtrado por permisos desde la API.
 */

import { useState } from "react";
import { ActionIcon, Badge, Button, Divider, Group, Indicator, Popover, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBell, IconChecks } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TbEmpty } from "@atoms/tables/DataTable";
import { useCanAccess } from "@modules/access-control/useCan";
import { fmtRelative } from "@utils/format";
import { notifyError } from "@utils/notify";
import { SEVERITY_COLOR, type Notification, dashboardApi } from "@dashboard/dashboard.service";

function Item({ n, onOpen }: Readonly<{ n: Notification; onOpen: (n: Notification) => void }>) {
  return (
    <UnstyledButton onClick={() => onOpen(n)} className={`w-full px-3 py-2 rounded-md hover:bg-gray-50 ${n.isRead ? "" : "bg-brand-50/60"}`}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--mantine-color-${SEVERITY_COLOR[n.severity]}-6)` }} />
        <div className="min-w-0 flex-1">
          <Group gap={6} wrap="nowrap" justify="space-between">
            <Text size="sm" fw={n.isRead ? 500 : 700} lineClamp={1}>
              {n.title}
            </Text>
            {n.isResolved && (
              <Badge size="xs" color="teal" variant="light">
                Resuelta
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {n.message}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {fmtRelative(n.createdAt)}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

export default function NotificationBell() {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const navigate = useNavigate();
  const canAccess = useCanAccess();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => dashboardApi.notifications(filter === "unread" ? true : undefined),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });
  const unread = list.data?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const read = useMutation({ mutationFn: dashboardApi.markRead, onSuccess: refresh, onError: (err) => notifyError(err) });
  const readAll = useMutation({ mutationFn: dashboardApi.markAllRead, onSuccess: refresh, onError: (err) => notifyError(err) });

  const open = (n: Notification) => {
    if (!n.isRead) read.mutate(n.id);
    setOpened(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={380} shadow="lg" radius="md" withArrow>
      <Popover.Target>
        <Indicator label={unread > 99 ? "99+" : unread} size={16} color="red" disabled={unread === 0} offset={4}>
          <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label={`Notificaciones (${unread} sin leer)`} onClick={() => setOpened((o) => !o)}>
            <IconBell size={22} stroke={1.6} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" pt="sm" pb="xs">
          <Text fw={700}>Notificaciones</Text>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as "unread" | "all")}
            data={[
              { value: "unread", label: `Sin leer${unread ? ` (${unread})` : ""}` },
              { value: "all", label: "Todas" }
            ]}
          />
        </Group>
        <Divider />
        <ScrollArea.Autosize mah={420} type="auto">
          <Stack gap={2} p={6}>
            {(list.data?.items ?? []).map((n) => (
              <Item key={n.id} n={n} onOpen={open} />
            ))}
            {list.data && list.data.items.length === 0 && <TbEmpty text={filter === "unread" ? "No tiene avisos sin leer" : "No tiene avisos"} />}
          </Stack>
        </ScrollArea.Autosize>
        <Divider />
        <Group justify="space-between" px="sm" py={6}>
          <Button size="xs" variant="subtle" leftSection={<IconChecks size={14} />} disabled={unread === 0} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Marcar todo como leído
          </Button>
          {canAccess("DSH_ALERTS") && (
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                setOpened(false);
                navigate("/dashboard/alerts");
              }}
            >
              Ver alertas
            </Button>
          )}
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
