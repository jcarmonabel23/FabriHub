/**
 * @project FabriHub - Front
 * @file src/app/admin/users/components/UserDetailDrawer.tsx
 * @description Detalle del usuario: estado de la cuenta, permisos efectivos por módulo y sesiones
 */

import { Badge, Drawer, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@admin/services/admin.service";
import { PERMISSION_LABEL } from "@admin/adminActions";
import { fmtDateTime, fmtRelative } from "@utils/format";

const REVOKE_LABEL: Record<string, string> = {
  logout: "Cerró sesión",
  logout_all: "Cerró todas",
  admin: "Administrador",
  reuse: "Reuso detectado",
  password_change: "Cambio de contraseña",
  password_reset: "Restablecimiento",
  deactivated: "Cuenta desactivada",
  idle: "Inactividad"
};

export default function UserDetailDrawer({ userId, onClose }: Readonly<{ userId: string | null; onClose: () => void }>) {
  const detail = useQuery({ queryKey: ["admin", "users", userId], queryFn: () => adminApi.getUser(userId!), enabled: Boolean(userId) });
  const sessions = useQuery({ queryKey: ["admin", "users", userId, "sessions"], queryFn: () => adminApi.sessions(userId!), enabled: Boolean(userId) });
  const u = detail.data;

  return (
    <Drawer opened={Boolean(userId)} onClose={onClose} position="right" size="lg" title="Detalle del usuario">
      {!u ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="lg">
          <div>
            <Title order={4}>{u.names}</Title>
            <Text c="dimmed" size="sm">
              {u.email}
            </Text>
            <Group gap={6} mt="xs">
              <Badge color={u.isActive ? "teal" : "gray"}>{u.isActive ? "Activo" : "Inactivo"}</Badge>
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge color="red">Bloqueado</Badge>}
              {u.mustChangePassword && <Badge color="orange">Cambio de contraseña pendiente</Badge>}
            </Group>
          </div>

          <Table variant="vertical" layout="fixed" withTableBorder>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={180}>Último ingreso</Table.Th>
                <Table.Td>
                  {fmtDateTime(u.lastLoginAt)} ({u.logins} ingresos)
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Contraseña cambiada</Table.Th>
                <Table.Td>{fmtRelative(u.passwordChangedAt)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Intentos fallidos</Table.Th>
                <Table.Td>{u.failedAttempts}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Creado</Table.Th>
                <Table.Td>{fmtDateTime(u.createdAt)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          <div>
            <Title order={6} tt="uppercase" c="petrol.8" mb="xs">
              Permisos efectivos
            </Title>
            {u.assignments.length === 0 ? (
              <Text size="sm" c="dimmed">
                Sin módulos asignados.
              </Text>
            ) : (
              <Stack gap={6}>
                {u.assignments.map((a) => (
                  <Group key={a.moduleCode} gap={4} wrap="wrap">
                    <Text size="sm" fw={600} w={170}>
                      {a.moduleName}
                    </Text>
                    {(a.effective ?? []).map((s) => (
                      <Badge key={s} size="xs" color={s === "access" ? "petrol" : "gray"}>
                        {PERMISSION_LABEL[s] ?? s}
                      </Badge>
                    ))}
                  </Group>
                ))}
              </Stack>
            )}
          </div>

          <div>
            <Title order={6} tt="uppercase" c="petrol.8" mb="xs">
              Sesiones recientes
            </Title>
            <Table fz="xs" striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Inicio</Table.Th>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>Última actividad</Table.Th>
                  <Table.Th>Estado</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sessions.data ?? []).map((s) => {
                  const live = !s.revokedAt && new Date(s.expiresAt) > new Date();
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>{fmtDateTime(s.createdAt)}</Table.Td>
                      <Table.Td>{s.ipAddress ?? "—"}</Table.Td>
                      <Table.Td>{fmtRelative(s.lastUsedAt)}</Table.Td>
                      <Table.Td>
                        {live ? (
                          <Badge size="xs" color="teal">
                            Activa
                          </Badge>
                        ) : (
                          <Badge size="xs" color="gray">
                            {s.revokeReason ? REVOKE_LABEL[s.revokeReason] ?? s.revokeReason : "Vencida"}
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        </Stack>
      )}
    </Drawer>
  );
}
