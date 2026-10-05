/**
 * @project FabriHub - Front
 * @file src/app/dashboard/alerts/Page.tsx
 * @description Tablero → Alertas (DSH_ALERTS): alarmas abiertas, historial y corridas del detector
 *
 * Solo se listan las alertas de módulos que el usuario puede ver (la API filtra). «Revisar ahora»
 * exige `configure` y lanza una corrida manual del mismo detector que corre cada hora.
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, Paper, Select, SimpleGrid, Tabs, Text, TextInput, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertOctagon, IconAlertTriangle, IconArrowRight, IconHistory, IconInfoCircle, IconListCheck, IconPlayerPlay, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan, useCanAccess } from "@modules/access-control/useCan";
import { fmtDateTime, fmtRelative } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import KpiCard from "../atoms/KpiCard";
import { DASHBOARD_ACTIONS } from "../dashboardActions";
import { type Alert, type AlertKind, type AlertRun, KIND_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, type Severity, dashboardApi } from "../dashboard.service";

const PAGE_SIZE = 25;

export function SeverityBadge({ severity }: Readonly<{ severity: Severity }>) {
  return (
    <Badge color={SEVERITY_COLOR[severity]} variant={severity === "critical" ? "filled" : "light"} size="sm">
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

function AlertsTab({ status }: Readonly<{ status: "open" | "resolved" }>) {
  const navigate = useNavigate();
  const canAccess = useCanAccess();
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [kind, setKind] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["dashboard", "alerts", { status, debounced, kind, severity, page }],
    queryFn: () => dashboardApi.alerts({ status, kind, severity, search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<Alert, unknown>[]>(
    () => [
      { header: "Severidad", size: 110, cell: ({ row: { original: a } }) => <SeverityBadge severity={a.severity} /> },
      {
        header: "Alerta",
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm" fw={600}>
              {a.title}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {a.message}
            </Text>
          </div>
        )
      },
      {
        header: "Tipo",
        size: 170,
        cell: ({ row: { original: a } }) => (
          <div>
            <Text size="sm">{KIND_LABEL[a.kind]}</Text>
            <Text size="xs" c="dimmed">
              {a.moduleName}
              {a.warehouseCode ? ` · ${a.warehouseCode}` : ""}
            </Text>
          </div>
        )
      },
      {
        header: status === "open" ? "Desde" : "Resuelta",
        size: 150,
        cell: ({ row: { original: a } }) => {
          const at = status === "open" ? a.firstSeenAt : a.resolvedAt;
          return (
            <Tooltip label={fmtDateTime(at)}>
              <Text size="sm">{fmtRelative(at)}</Text>
            </Tooltip>
          );
        }
      },
      {
        id: "go",
        header: "",
        size: 50,
        cell: ({ row: { original: a } }) =>
          a.link && canAccess(a.moduleCode) ? (
            <Tooltip label="Ir a la pantalla">
              <ActionIcon variant="light" onClick={() => navigate(a.link!)} aria-label="Ir a la pantalla">
                <IconArrowRight size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null
      }
    ],
    [status, canAccess, navigate]
  );

  return (
    <>
      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Buscar en título o detalle"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          w={280}
        />
        <Select
          placeholder="Tipo"
          clearable
          data={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
          w={220}
        />
        <Select
          placeholder="Severidad"
          clearable
          data={(["critical", "warning", "info"] as Severity[]).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }))}
          value={severity}
          onChange={(v) => {
            setSeverity(v);
            setPage(1);
          }}
          w={160}
        />
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(a) => a.id}
        emptyText={status === "open" ? "No hay alertas abiertas: todo en orden" : "No hay alertas resueltas"}
      />
    </>
  );
}

function RunsTab() {
  const runs = useQuery({ queryKey: ["dashboard", "alert-runs"], queryFn: dashboardApi.alertRuns });
  const columns = useMemo<ColumnDef<AlertRun, unknown>[]>(
    () => [
      { header: "Inicio", size: 150, cell: ({ row: { original: r } }) => <Text size="sm">{fmtDateTime(r.startedAt)}</Text> },
      {
        header: "Origen",
        size: 160,
        cell: ({ row: { original: r } }) => (
          <Text size="sm">{r.trigger === "manual" ? `Manual · ${r.runBy ?? "—"}` : "Programada"}</Text>
        )
      },
      { header: "Abiertas", size: 80, cell: ({ row: { original: r } }) => <Text size="sm">{r.openAlerts}</Text> },
      { header: "Nuevas", size: 80, cell: ({ row: { original: r } }) => <Text size="sm" fw={r.newAlerts ? 700 : 400}>{r.newAlerts}</Text> },
      { header: "Resueltas", size: 80, cell: ({ row: { original: r } }) => <Text size="sm">{r.resolvedAlerts}</Text> },
      { header: "Avisos", size: 80, cell: ({ row: { original: r } }) => <Text size="sm">{r.notifications}</Text> },
      { header: "Correos", size: 80, cell: ({ row: { original: r } }) => <Text size="sm">{r.emails}</Text> },
      {
        header: "Resultado",
        cell: ({ row: { original: r } }) =>
          r.error ? (
            <Text size="xs" c="red" lineClamp={2}>
              {r.error}
            </Text>
          ) : r.finishedAt ? (
            <Badge color="teal" variant="light" size="sm">
              Completada
            </Badge>
          ) : (
            <Badge color="gray" variant="light" size="sm">
              En curso
            </Badge>
          )
      }
    ],
    []
  );
  return <DataTable data={runs.data ?? []} columns={columns} loading={runs.isLoading} rowKey={(r) => r.id} emptyText="El detector aún no ha corrido" />;
}

export default function AlertsPage() {
  const can = useCan("DSH_ALERTS");
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["dashboard", "alerts-summary"], queryFn: dashboardApi.alertsSummary });
  const s = summary.data;

  const run = useMutation({
    mutationFn: dashboardApi.runAlerts,
    onSuccess: (r) => {
      notifySuccess(
        `${r.openAlerts} abiertas · ${r.newAlerts} nuevas · ${r.resolvedAlerts} resueltas · ${r.notifications} avisos · ${r.emails} correos`,
        "Revisión completada"
      );
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => notifyError(err)
  });

  const kinds = Object.entries(s?.byKind ?? {}).sort((a, b) => b[1] - a[1]) as [AlertKind, number][];

  return (
    <div className="p-6">
      <ModuleHeader
        title="Alertas"
        description="Existencias bajo el mínimo, lotes por vencer y documentos atrasados, detectados cada hora."
        actions={DASHBOARD_ACTIONS}
        right={
          can("configure") && (
            <Button leftSection={<IconPlayerPlay size={16} />} color="orange" loading={run.isPending} onClick={() => run.mutate()}>
              Revisar ahora
            </Button>
          )
        }
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="md">
        <KpiCard label="Críticas" value={String(s?.bySeverity.critical ?? 0)} icon={IconAlertOctagon} color="red" />
        <KpiCard label="Advertencias" value={String(s?.bySeverity.warning ?? 0)} icon={IconAlertTriangle} color="orange" />
        <KpiCard label="Avisos" value={String(s?.bySeverity.info ?? 0)} icon={IconInfoCircle} color="blue" />
        <KpiCard
          label="Última revisión"
          value={s?.lastRun ? fmtRelative(s.lastRun.finishedAt) : "Nunca"}
          hint={s?.lastRun ? `${s.lastRun.trigger === "manual" ? "Manual" : "Programada"} · ${fmtDateTime(s.lastRun.finishedAt)}` : "El detector corre al minuto de arrancar la API"}
          icon={IconHistory}
          color={s?.lastRun?.error ? "red" : "petrol"}
        />
      </SimpleGrid>

      {kinds.length > 0 && (
        <Paper withBorder radius="lg" p="sm" mb="md">
          <Group gap="xs">
            <Text size="sm" fw={600} mr="xs">
              Abiertas por tipo:
            </Text>
            {kinds.map(([k, n]) => (
              <Badge key={k} variant="light" color="gray">
                {KIND_LABEL[k]}: {n}
              </Badge>
            ))}
          </Group>
        </Paper>
      )}

      <Tabs defaultValue="open" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="open" leftSection={<IconAlertTriangle size={16} />}>
            Abiertas
          </Tabs.Tab>
          <Tabs.Tab value="resolved" leftSection={<IconListCheck size={16} />}>
            Resueltas
          </Tabs.Tab>
          <Tabs.Tab value="runs" leftSection={<IconHistory size={16} />}>
            Corridas del detector
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="open">
          <AlertsTab status="open" />
        </Tabs.Panel>
        <Tabs.Panel value="resolved">
          <AlertsTab status="resolved" />
        </Tabs.Panel>
        <Tabs.Panel value="runs">
          <RunsTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
