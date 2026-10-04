/**
 * @project FabriHub - Front
 * @file src/app/admin/users/Page.tsx
 * @description Seguridad → Usuarios (ADM_USERS)
 *
 * Cada botón se pinta según `useCan("ADM_USERS")`; la API vuelve a validar cada acción.
 */

import { useMemo, useState } from "react";
import { ActionIcon, Avatar, Badge, Button, Group, Menu, Select, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconDotsVertical,
  IconEye,
  IconKey,
  IconLockOpen,
  IconLogout,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStack2,
  IconUserCheck,
  IconUserOff
} from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ADMIN_ACTIONS } from "@admin/adminActions";
import { adminApi } from "@admin/services/admin.service";
import type { UserDetail, UserRow } from "@admin/types";
import { coreAuth } from "@auth/store/coreAuth";
import { useCan } from "@modules/access-control/useCan";
import { fmtRelative, initials } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import AssignModulesModal from "./components/AssignModulesModal";
import UserDetailDrawer from "./components/UserDetailDrawer";
import UserFormModal from "./components/UserFormModal";

const MODULE_CODE = "ADM_USERS";
const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
  { value: "locked", label: "Bloqueados" },
  { value: "pending", label: "Cambio de contraseña pendiente" }
];

export default function UsersAdminPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE_CODE);
  const me = coreAuth((s) => s.user?.id);

  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<UserDetail | null>(null);

  const users = useQuery({
    queryKey: ["admin", "users", { debounced, status, page }],
    queryFn: () => adminApi.listUsers({ search: debounced, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const action = useMutation({
    mutationFn: async ({ kind, user }: { kind: "unlock" | "reset" | "revoke" | "toggle"; user: UserRow }) => {
      if (kind === "unlock") return adminApi.unlockUser(user.id).then(() => "Cuenta desbloqueada");
      if (kind === "reset") return adminApi.resetPassword(user.id).then((r) => r.message);
      if (kind === "revoke") return adminApi.revokeSessions(user.id).then(() => "Sesiones cerradas");
      return adminApi.updateUser(user.id, { isActive: !user.isActive }).then(() => (user.isActive ? "Usuario desactivado" : "Usuario activado"));
    },
    onSuccess: (msg) => {
      notifySuccess(msg);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const confirm = (kind: "unlock" | "reset" | "revoke" | "toggle", user: UserRow) => {
    const texts = {
      unlock: ["Desbloquear cuenta", `Se reiniciarán los intentos fallidos de ${user.names}.`],
      reset: ["Reiniciar contraseña", `Se enviará una contraseña temporal a ${user.email}, se cerrarán sus sesiones y deberá cambiarla al entrar.`],
      revoke: ["Cerrar sesiones", `Se cerrarán todas las sesiones abiertas de ${user.names} de inmediato.`],
      toggle: user.isActive
        ? ["Desactivar usuario", `${user.names} no podrá iniciar sesión y sus sesiones se cerrarán de inmediato.`]
        : ["Activar usuario", `${user.names} podrá volver a iniciar sesión.`]
    }[kind];
    modals.openConfirmModal({
      title: texts[0],
      children: <Text size="sm">{texts[1]}</Text>,
      labels: { confirm: "Confirmar", cancel: "Cancelar" },
      confirmProps: { color: kind === "toggle" && user.isActive ? "red" : "petrol" },
      onConfirm: () => action.mutate({ kind, user })
    });
  };

  const openAssign = async (user: UserRow) => {
    try {
      setAssigning(await adminApi.getUser(user.id));
    } catch (err) {
      notifyError(err);
    }
  };

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        header: "Usuario",
        cell: ({ row: { original: u } }) => (
          <Group gap="sm" wrap="nowrap">
            <Avatar color="petrol" radius="xl" size={34}>
              {initials(u.names)}
            </Avatar>
            <div className="leading-tight">
              <Text size="sm" fw={600}>
                {u.names} {u.id === me && <Badge size="xs">Usted</Badge>}
              </Text>
              <Text size="xs" c="dimmed">
                {u.email}
              </Text>
            </div>
          </Group>
        )
      },
      {
        header: "Estado",
        cell: ({ row: { original: u } }) => (
          <Group gap={4}>
            <Badge color={u.isActive ? "teal" : "gray"}>{u.isActive ? "Activo" : "Inactivo"}</Badge>
            {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge color="red">Bloqueado</Badge>}
            {u.mustChangePassword && <Badge color="orange">Clave pendiente</Badge>}
          </Group>
        )
      },
      { header: "Módulos", accessorKey: "modulesCount", size: 90 },
      {
        header: "Sesiones",
        size: 90,
        cell: ({ row: { original: u } }) => <Badge color={u.activeSessions ? "petrol" : "gray"}>{u.activeSessions}</Badge>
      },
      { header: "Último ingreso", cell: ({ row: { original: u } }) => <Text size="sm">{fmtRelative(u.lastLoginAt)}</Text> },
      {
        id: "actions",
        header: "",
        size: 50,
        cell: ({ row: { original: u } }) => (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Acciones" onClick={(e) => e.stopPropagation()}>
                <IconDotsVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              <Menu.Item leftSection={<IconEye size={16} />} onClick={() => setDetailId(u.id)}>
                Ver detalle
              </Menu.Item>
              {can("edit") && (
                <Menu.Item
                  leftSection={<IconPencil size={16} />}
                  onClick={() => {
                    setEditing(u);
                    setFormOpen(true);
                  }}
                >
                  Editar
                </Menu.Item>
              )}
              {can("configure") && (
                <>
                  <Menu.Item leftSection={<IconStack2 size={16} />} onClick={() => openAssign(u)}>
                    Módulos y roles
                  </Menu.Item>
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                    <Menu.Item leftSection={<IconLockOpen size={16} />} onClick={() => confirm("unlock", u)}>
                      Desbloquear
                    </Menu.Item>
                  )}
                  {u.id !== me && (
                    <Menu.Item leftSection={<IconKey size={16} />} onClick={() => confirm("reset", u)}>
                      Reiniciar contraseña
                    </Menu.Item>
                  )}
                  <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => confirm("revoke", u)} disabled={!u.activeSessions}>
                    Cerrar sesiones
                  </Menu.Item>
                </>
              )}
              {can("edit") && u.id !== me && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color={u.isActive ? "red" : "teal"}
                    leftSection={u.isActive ? <IconUserOff size={16} /> : <IconUserCheck size={16} />}
                    onClick={() => confirm("toggle", u)}
                  >
                    {u.isActive ? "Desactivar" : "Activar"}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, me]
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Usuarios" description="Cuentas, accesos por módulo y sesiones" actions={ADMIN_ACTIONS} />

      <Group justify="space-between" mb="md" gap="sm">
        <Group gap="sm">
          <TextInput
            placeholder="Buscar por nombre o correo"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setPage(1);
            }}
            w={280}
          />
          <Select
            data={STATUS_OPTIONS}
            value={status}
            onChange={(v) => {
              setStatus(v ?? "");
              setPage(1);
            }}
            w={240}
          />
        </Group>
        {can("add_new") && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Agregar usuario
          </Button>
        )}
      </Group>

      <DataTable
        data={users.data?.items ?? []}
        columns={columns}
        loading={users.isLoading}
        total={users.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(u) => u.id}
        onRowClick={(u) => setDetailId(u.id)}
        emptyText="No hay usuarios con esos filtros"
      />

      <UserFormModal opened={formOpen} onClose={() => setFormOpen(false)} user={editing} />
      <UserDetailDrawer userId={detailId} onClose={() => setDetailId(null)} />
      <AssignModulesModal user={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
