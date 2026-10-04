/**
 * @project FabriHub - Front
 * @file src/app/admin/users/components/AssignModulesModal.tsx
 * @description Asignación RBAC: por cada pantalla, roles + permisos extra (modelo DaviHub)
 *
 * Muestra en vivo los permisos EFECTIVOS (unión de roles + extras), que es exactamente lo que
 * calcula la vista v_users_effective_permissions en la BD.
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Group, Loader, Modal, MultiSelect, Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@admin/services/admin.service";
import { settingsApi } from "@/app/settings/services/settings.service";
import { PERMISSION_LABEL } from "@admin/adminActions";
import type { UserDetail } from "@admin/types";
import { notifyError, notifySuccess } from "@utils/notify";

interface Draft {
  roleIds: string[];
  permissions: string[];
}

export default function AssignModulesModal({ user, onClose }: Readonly<{ user: UserDetail | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ["admin", "lookups"], queryFn: adminApi.lookups, enabled: Boolean(user) });
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: Boolean(user) });

  useEffect(() => {
    if (!user) return;
    setWarehouseIds(user.warehouses.map((w) => w.id));
    setDraft(Object.fromEntries(user.assignments.map((a) => [a.moduleCode, { roleIds: a.roleIds, permissions: a.permissions }])));
  }, [user]);

  const groups = useMemo(() => {
    const out = new Map<string, { parentName: string; modules: NonNullable<typeof lookups.data>["modules"] }>();
    for (const m of lookups.data?.modules ?? []) {
      if (!out.has(m.parentCode)) out.set(m.parentCode, { parentName: m.parentName, modules: [] });
      out.get(m.parentCode)!.modules.push(m);
    }
    return [...out.values()];
  }, [lookups.data]);

  const rolePerms = useMemo(() => new Map((lookups.data?.roles ?? []).map((r) => [r.id, r.permissions])), [lookups.data]);
  const order = (lookups.data?.permissions ?? []).map((p) => p.slug);
  const effective = (d: Draft) => {
    const set = new Set([...d.permissions, ...d.roleIds.flatMap((r) => rolePerms.get(r) ?? [])]);
    return order.filter((s) => set.has(s));
  };

  const save = useMutation({
    mutationFn: async () => {
      await adminApi.setModules(
        user!.id,
        Object.entries(draft).map(([moduleCode, d]) => ({ moduleCode, roleIds: d.roleIds, permissions: d.permissions }))
      );
      return adminApi.setWarehouses(user!.id, warehouseIds);
    },
    onSuccess: () => {
      notifySuccess("Módulos actualizados. El usuario verá el cambio en su próxima renovación de sesión (≤ 4 min).");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const toggle = (code: string, on: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      if (on) next[code] = { roleIds: [], permissions: [] };
      else delete next[code];
      return next;
    });

  const roleOptions = (lookups.data?.roles ?? []).map((r) => ({ value: r.id, label: r.name }));
  const permOptions = (lookups.data?.permissions ?? []).map((p) => ({ value: p.slug, label: p.name }));

  return (
    <Modal opened={Boolean(user)} onClose={onClose} title={`Módulos de ${user?.names ?? ""}`} size="xl">
      {lookups.isLoading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            Marque las pantallas que puede usar y elija uno o varios roles. Los permisos extra se suman a los del rol.
            Sin el permiso <b>Acceso</b> la pantalla no aparece.
          </Text>
          <ScrollArea.Autosize mah="60vh" type="auto">
            <Stack gap="lg" pr="sm">
              {groups.map((g) => (
                <div key={g.parentName}>
                  <Title order={6} c="petrol.8" tt="uppercase" mb="xs">
                    {g.parentName}
                  </Title>
                  <Stack gap="xs">
                    {g.modules.map((m) => {
                      const d = draft[m.code];
                      const eff = d ? effective(d) : [];
                      return (
                        <Paper key={m.code} withBorder radius="md" p="sm" className={d ? "border-brand-200 bg-brand-50/40" : ""}>
                          <Group justify="space-between" wrap="nowrap">
                            <Checkbox
                              label={
                                <span>
                                  <b>{m.name}</b> <span className="text-xs text-gray-400">{m.code}</span>
                                </span>
                              }
                              checked={Boolean(d)}
                              onChange={(e) => toggle(m.code, e.currentTarget.checked)}
                            />
                            {m.isOffline && (
                              <Badge color="gray" size="xs">
                                Fuera de servicio
                              </Badge>
                            )}
                          </Group>
                          {d && (
                            <Stack gap="xs" mt="sm" pl={30}>
                              <Group grow align="flex-start">
                                <MultiSelect
                                  size="xs"
                                  label="Roles"
                                  data={roleOptions}
                                  value={d.roleIds}
                                  onChange={(v) => setDraft((x) => ({ ...x, [m.code]: { ...d, roleIds: v } }))}
                                  clearable
                                />
                                <MultiSelect
                                  size="xs"
                                  label="Permisos extra"
                                  data={permOptions}
                                  value={d.permissions}
                                  onChange={(v) => setDraft((x) => ({ ...x, [m.code]: { ...d, permissions: v } }))}
                                  clearable
                                />
                              </Group>
                              <Group gap={4}>
                                <Text size="xs" c="dimmed">
                                  Efectivos:
                                </Text>
                                {eff.length === 0 ? (
                                  <Text size="xs" c="red">
                                    ninguno
                                  </Text>
                                ) : (
                                  eff.map((s) => (
                                    <Badge key={s} size="xs" color={s === "access" ? "petrol" : "gray"}>
                                      {PERMISSION_LABEL[s] ?? s}
                                    </Badge>
                                  ))
                                )}
                                {!eff.includes("access") && eff.length > 0 && (
                                  <Text size="xs" c="orange">
                                    · sin Acceso no podrá entrar
                                  </Text>
                                )}
                              </Group>
                            </Stack>
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>
                </div>
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Paper withBorder radius="md" p="sm">
            <MultiSelect
              label="Almacenes asignados (alcance de datos)"
              description="Sin el permiso «Ver todo», en los módulos de Inventario solo verá y moverá estos almacenes."
              data={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
              value={warehouseIds}
              onChange={setWarehouseIds}
              clearable
              searchable
            />
          </Paper>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Guardar asignación
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
