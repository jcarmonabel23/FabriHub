/**
 * @project FabriHub - Front
 * @file src/layouts/components/UserProfileMenu.tsx
 * @description Menú del usuario en el header: cuenta, cambio de contraseña y cierres de sesión
 */

import { Avatar, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconChevronDown, IconDevicesOff, IconKey, IconLogout } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { signOut } from "@auth/logout/logout.service";
import { logoutAllRequest } from "@auth/services/auth.service";
import { initials } from "@utils/format";
import { notifyError } from "@utils/notify";

export default function UserProfileMenu() {
  const navigate = useNavigate();
  const user = coreAuth((s) => s.user);
  if (!user) return null;

  const confirmLogoutAll = () =>
    modals.openConfirmModal({
      title: "Cerrar todas las sesiones",
      children: (
        <Text size="sm">
          Se cerrará su sesión en todos los equipos y navegadores, incluido este. Úselo si cree que alguien más
          accedió a su cuenta.
        </Text>
      ),
      labels: { confirm: "Cerrar todas", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await logoutAllRequest();
          await signOut();
        } catch (err) {
          notifyError(err);
        }
      }
    });

  return (
    <Menu position="bottom-end" width={240} shadow="md">
      <Menu.Target>
        <UnstyledButton className="rounded-lg px-2 py-1 hover:bg-gray-50">
          <Group gap="xs" wrap="nowrap">
            <Avatar color="petrol" radius="xl" size={34}>
              {initials(user.names)}
            </Avatar>
            <div className="hidden sm:block leading-tight text-left">
              <Text size="sm" fw={600} lineClamp={1}>
                {user.names}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {user.email}
              </Text>
            </div>
            <IconChevronDown size={14} className="text-gray-400" />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Mi cuenta</Menu.Label>
        <Menu.Item leftSection={<IconKey size={16} />} onClick={() => navigate("/account/password")}>
          Cambiar contraseña
        </Menu.Item>
        <Menu.Item leftSection={<IconDevicesOff size={16} />} onClick={confirmLogoutAll}>
          Cerrar todas mis sesiones
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => signOut()}>
          Cerrar sesión
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
