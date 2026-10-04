/**
 * @project FabriHub - Front
 * @file src/app/dashboard/components/DashboardUser.tsx
 * @description Tarjeta lateral del tablero: usuario, estado de seguridad y alcance de permisos
 */

import { Avatar, Badge, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconLock, IconShieldCheck, IconStack2 } from "@tabler/icons-react";
import { coreAuth } from "@auth/store/coreAuth";
import { canAccessModule } from "@modules/access-control/moduleTree";
import { initials } from "@utils/format";

export default function DashboardUser() {
  const user = coreAuth((s) => s.user);
  const modules = coreAuth((s) => s.modules);
  const idleMinutes = coreAuth((s) => s.idleMinutes);
  if (!user) return null;

  const leaves = modules.filter((m) => m.parentCode && canAccessModule(m));
  const operative = leaves.filter((m) => !m.isOffline).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <Stack align="center" gap={4}>
        <Avatar color="petrol" radius="xl" size={72}>
          {initials(user.names)}
        </Avatar>
        <Text fw={700} mt="sm" ta="center">
          {user.names}
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          {user.email}
        </Text>
      </Stack>

      <Stack gap="sm" mt="lg">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="teal" radius="md">
            <IconShieldCheck size={18} />
          </ThemeIcon>
          <Text size="sm">Sesión verificada con código OTP</Text>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="petrol" radius="md">
            <IconLock size={18} />
          </ThemeIcon>
          <Text size="sm">Cierre automático tras {idleMinutes} min de inactividad</Text>
        </Group>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="gray" radius="md">
            <IconStack2 size={18} />
          </ThemeIcon>
          <Text size="sm">
            {operative} pantalla(s) operativas{" "}
            {leaves.length > operative && (
              <Badge size="xs" color="gray">
                +{leaves.length - operative} próximamente
              </Badge>
            )}
          </Text>
        </Group>
      </Stack>
    </div>
  );
}
