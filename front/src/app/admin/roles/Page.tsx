/**
 * @project FabriHub - Front
 * @file src/app/admin/roles/Page.tsx
 * @description Seguridad → Roles (ADM_ROLES): conjuntos de permisos que se asignan por módulo
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Checkbox, Group, Modal, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconLock, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ADMIN_ACTIONS, PERMISSION_LABEL } from "@admin/adminActions";
import { adminApi } from "@admin/services/admin.service";
import type { Role } from "@admin/types";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";

const MODULE_CODE = "ADM_ROLES";

function RoleModal({ opened, role, onClose }: Readonly<{ opened: boolean; role: Role | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ["admin", "permissions"], queryFn: adminApi.listPermissions, enabled: opened });
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const locked = role?.slug === "admin";

  useEffect(() => {
    if (!opened) return;
    setSlug(role?.slug ?? "");
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPermissions(role?.permissions ?? ["access"]);
  }, [opened, role]);

  const save = useMutation({
    mutationFn: () =>
      role
        ? adminApi.updateRole(role.id, { name, description, ...(locked ? {} : { permissions }) })
        : adminApi.createRole({ slug, name, description, permissions }),
    onSuccess: () => {
      notifySuccess(role ? "Rol actualizado" : "Rol creado");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const valid = name.trim().length >= 3 && (role || /^[a-z][a-z0-9_]{2,39}$/.test(slug)) && (permissions.length === 0 || permissions.includes("access"));

  return (
    <Modal opened={opened} onClose={onClose} title={role ? `Editar rol: ${role.name}` : "Nuevo rol"} size="lg">
      <Stack>
        <Group grow>
          <TextInput label="Nombre" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput
            label="Identificador"
            description="minúsculas y _"
            required
            disabled={Boolean(role)}
            value={slug}
            onChange={(e) => setSlug(e.currentTarget.value.toLowerCase())}
          />
        </Group>
        <Textarea label="Descripción" autosize minRows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        <Checkbox.Group label="Permisos que concede" value={permissions} onChange={setPermissions}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs">
            {(perms.data ?? []).map((p) => (
              <Checkbox key={p.slug} value={p.slug} disabled={locked} label={p.name} description={p.description} />
            ))}
          </SimpleGrid>
        </Checkbox.Group>
        {locked && (
          <Text size="xs" c="dimmed" className="flex items-center gap-1">
            <IconLock size={14} /> El rol Administrador conserva siempre todos los permisos.
          </Text>
        )}
        {permissions.length > 0 && !permissions.includes("access") && (
          <Text size="xs" c="red">
            Todo rol debe incluir Acceso; sin él los demás permisos no sirven.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function RolesAdminPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE_CODE);
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: adminApi.listRoles });
  const [modal, setModal] = useState<{ open: boolean; role: Role | null }>({ open: false, role: null });

  const toggle = useMutation({
    mutationFn: (r: Role) => adminApi.updateRole(r.id, { isActive: !r.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "roles"] }),
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({
    mutationFn: (r: Role) => adminApi.deleteRole(r.id),
    onSuccess: () => {
      notifySuccess("Rol eliminado");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Role, unknown>[]>(
    () => [
      {
        header: "Rol",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={600}>
              {r.name} {r.isSystem && <Badge size="xs" color="gray">Sistema</Badge>}
            </Text>
            <Text size="xs" c="dimmed">
              {r.description}
            </Text>
          </div>
        )
      },
      {
        header: "Permisos",
        cell: ({ row: { original: r } }) => (
          <Group gap={4} maw={420}>
            {r.permissions.map((p) => (
              <Badge key={p} size="xs" color={p === "access" ? "petrol" : "gray"}>
                {PERMISSION_LABEL[p] ?? p}
              </Badge>
            ))}
          </Group>
        )
      },
      { header: "Usuarios", accessorKey: "usersCount", size: 90 },
      {
        header: "Activo",
        size: 80,
        cell: ({ row: { original: r } }) => (
          <Switch checked={r.isActive} disabled={!can("edit") || r.slug === "admin"} onChange={() => toggle.mutate(r)} aria-label="Activo" />
        )
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row: { original: r } }) => (
          <Group gap={4} justify="flex-end">
            {can("edit") && (
              <Tooltip label="Editar">
                <ActionIcon variant="subtle" onClick={() => setModal({ open: true, role: r })} aria-label="Editar">
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {can("delete") && !r.isSystem && (
              <Tooltip label={r.usersCount ? "En uso: desasígnelo primero" : "Eliminar"}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={r.usersCount > 0}
                  aria-label="Eliminar"
                  onClick={() =>
                    modals.openConfirmModal({
                      title: "Eliminar rol",
                      children: <Text size="sm">¿Eliminar el rol «{r.name}»? No se puede deshacer.</Text>,
                      labels: { confirm: "Eliminar", cancel: "Cancelar" },
                      confirmProps: { color: "red" },
                      onConfirm: () => remove.mutate(r)
                    })
                  }
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Roles"
        description="Conjuntos de permisos que se asignan por módulo"
        actions={ADMIN_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, role: null })}>
              Nuevo rol
            </Button>
          )
        }
      />
      <DataTable data={roles.data ?? []} columns={columns} loading={roles.isLoading} rowKey={(r) => r.id} />
      <RoleModal opened={modal.open} role={modal.role} onClose={() => setModal({ open: false, role: null })} />
    </div>
  );
}
