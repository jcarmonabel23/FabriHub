/**
 * @project FabriHub - Front
 * @file src/app/admin/modules/Page.tsx
 * @description Seguridad → Módulos (ADM_MODULES): fuera de servicio y visibilidad por entorno
 */

import { useMemo } from "react";
import { Badge, Group, Switch, Text, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ADMIN_ACTIONS } from "@admin/adminActions";
import { adminApi } from "@admin/services/admin.service";
import type { AdminModule } from "@admin/types";
import { useCan } from "@modules/access-control/useCan";
import { ModuleIcon } from "@modules/icons/moduleIcons";
import { notifyError } from "@utils/notify";

const MODULE_CODE = "ADM_MODULES";
type Flag = "isOffline" | "isShowDev" | "isShowQa" | "isShowProd";

const isProtected = (m: AdminModule) => m.code === "ADMIN" || m.parentCode === "ADMIN" || m.code === "DASHBOARD";

export default function ModulesAdminPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE_CODE);
  const modules = useQuery({ queryKey: ["admin", "modules"], queryFn: adminApi.listModules });

  const update = useMutation({
    mutationFn: ({ m, flag, value }: { m: AdminModule; flag: Flag; value: boolean }) => adminApi.updateModule(m.id, { [flag]: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "modules"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<AdminModule, unknown>[]>(() => {
    const flag = (key: Flag, label: string, inverse = false) => ({
      id: key,
      header: label,
      size: 90,
      cell: ({ row: { original: m } }: { row: { original: AdminModule } }) => {
        const disabled = !can("configure") || isProtected(m);
        return (
          <Tooltip label="Tablero y Seguridad no se pueden apagar ni ocultar" disabled={!isProtected(m)}>
            <div className="inline-block">
              <Switch
                size="sm"
                color={inverse ? "red" : "petrol"}
                checked={m[key]}
                disabled={disabled}
                onChange={(e) => update.mutate({ m, flag: key, value: e.currentTarget.checked })}
                aria-label={label}
              />
            </div>
          </Tooltip>
        );
      }
    });

    return [
      {
        header: "Módulo",
        cell: ({ row: { original: m } }) => (
          <Group gap="sm" wrap="nowrap" pl={m.parentCode ? 28 : 0}>
            <ModuleIcon icon={m.icon} size={20} className={m.parentCode ? "text-gray-400" : "text-brand-700"} />
            <div className="leading-tight">
              <Text size="sm" fw={m.parentCode ? 500 : 700}>
                {m.name}
              </Text>
              <Text size="xs" c="dimmed">
                {m.code} · {m.path}
              </Text>
            </div>
          </Group>
        )
      },
      {
        header: "Fase",
        size: 70,
        cell: ({ row: { original: m } }) => (m.metadata?.phase !== undefined ? <Badge color="gray">F{m.metadata.phase}</Badge> : null)
      },
      { header: "Usuarios", size: 80, cell: ({ row: { original: m } }) => (m.parentCode ? m.usersCount : "") },
      flag("isOffline", "Fuera de servicio", true),
      flag("isShowDev", "Dev"),
      flag("isShowQa", "QA"),
      flag("isShowProd", "Prod")
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);

  return (
    <div className="p-6">
      <ModuleHeader title="Módulos" description="Estado y visibilidad por entorno de cada pantalla" actions={ADMIN_ACTIONS} />
      <Text size="sm" c="dimmed" mb="md">
        <b>Fuera de servicio</b> muestra la pantalla de mantenimiento y la API rechaza sus operaciones. Desmarcar un
        entorno oculta el módulo allí por completo, como si no existiera.
      </Text>
      <DataTable data={modules.data ?? []} columns={columns} loading={modules.isLoading} rowKey={(m) => m.id} />
    </div>
  );
}
