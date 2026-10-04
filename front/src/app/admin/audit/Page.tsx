/**
 * @project FabriHub - Front
 * @file src/app/admin/audit/Page.tsx
 * @description Seguridad → Auditoría (ADM_AUDIT): cambios en datos (antes/después) y bitácora de accesos
 */

import { useMemo, useState } from "react";
import { Badge, Code, Group, Modal, Select, Table, Tabs, Text, TextInput } from "@mantine/core";
import { DatePickerInput, type DatesRangeValue } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDatabase, IconLogin, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ADMIN_ACTIONS } from "@admin/adminActions";
import { adminApi } from "@admin/services/admin.service";
import type { AuthAuditRow, DataAuditRow } from "@admin/types";
import { fmtDateTimeSec, shortId } from "@utils/format";

const PAGE_SIZE = 25;

const ACTION = { I: ["Alta", "teal"], U: ["Cambio", "blue"], D: ["Baja", "red"] } as const;

const EVENT_LABEL: Record<string, string> = {
  sign_in: "Inicio de sesión",
  otp_verify: "Verificación OTP",
  otp_resend: "Reenvío OTP",
  refresh: "Renovación",
  refresh_reuse: "Reuso de token (robo)",
  logout: "Cierre de sesión",
  logout_all: "Cierre de todas",
  locked: "Cuenta bloqueada",
  password_change: "Cambio de contraseña",
  password_forgot: "Solicitud de recuperación",
  password_reset: "Restablecimiento",
  admin_reset: "Reinicio por admin",
  admin_unlock: "Desbloqueo por admin",
  admin_revoke_sessions: "Sesiones cerradas por admin"
};

const toRange = (r: DatesRangeValue) => ({
  from: r[0] ? dayjs(r[0]).startOf("day").toISOString() : undefined,
  to: r[1] ? dayjs(r[1]).add(1, "day").startOf("day").toISOString() : undefined
});

function DiffModal({ row, onClose }: Readonly<{ row: DataAuditRow | null; onClose: () => void }>) {
  if (!row) return null;
  const keys = row.action === "U" ? row.changedFields ?? [] : Object.keys(row.newData ?? row.oldData ?? {});
  const show = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Modal opened onClose={onClose} title={`${ACTION[row.action][0]} en ${row.tableName}`} size="xl">
      <Text size="sm" c="dimmed" mb="sm">
        {fmtDateTimeSec(row.createdAt)} · {row.userNames ?? "Sistema"} · registro <Code>{row.recordId}</Code> · traza{" "}
        <Code>{shortId(row.traceId)}</Code>
      </Text>
      <Table withTableBorder striped fz="xs" layout="fixed">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={180}>Campo</Table.Th>
            {row.action !== "I" && <Table.Th>Antes</Table.Th>}
            {row.action !== "D" && <Table.Th>Después</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {keys.map((k) => (
            <Table.Tr key={k}>
              <Table.Td fw={600}>{k}</Table.Td>
              {row.action !== "I" && <Table.Td className="break-all text-red-700">{show(row.oldData?.[k])}</Table.Td>}
              {row.action !== "D" && <Table.Td className="break-all text-teal-700">{show(row.newData?.[k])}</Table.Td>}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}

function DataAuditTab() {
  const [table, setTable] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [range, setRange] = useState<DatesRangeValue>([null, null]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DataAuditRow | null>(null);

  const tables = useQuery({ queryKey: ["admin", "audit", "tables"], queryFn: adminApi.auditTables });
  const rows = useQuery({
    queryKey: ["admin", "audit", "data", { table, action, range, page }],
    queryFn: () => adminApi.dataAudit({ table, action, ...toRange(range), page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<DataAuditRow, unknown>[]>(
    () => [
      { header: "Fecha", size: 160, cell: ({ row: { original: r } }) => <Text size="sm">{fmtDateTimeSec(r.createdAt)}</Text> },
      {
        header: "Usuario",
        cell: ({ row: { original: r } }) => (
          <Text size="sm">{r.userNames ?? <span className="text-gray-400">Sistema</span>}</Text>
        )
      },
      { header: "Tabla", accessorKey: "tableName" },
      {
        header: "Acción",
        size: 90,
        cell: ({ row: { original: r } }) => <Badge color={ACTION[r.action][1]}>{ACTION[r.action][0]}</Badge>
      },
      { header: "Registro", cell: ({ row: { original: r } }) => <Code>{shortId(r.recordId)}</Code> },
      {
        header: "Campos",
        cell: ({ row: { original: r } }) => (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {r.action === "U" ? (r.changedFields ?? []).join(", ") : "registro completo"}
          </Text>
        )
      }
    ],
    []
  );

  return (
    <>
      <Group mb="md" gap="sm">
        <Select placeholder="Todas las tablas" clearable allowDeselect data={tables.data ?? []} value={table} onChange={(v) => (setTable(v), setPage(1))} w={220} />
        <Select
          placeholder="Todas las acciones"
          clearable
          allowDeselect
          data={[
            { value: "I", label: "Altas" },
            { value: "U", label: "Cambios" },
            { value: "D", label: "Bajas" }
          ]}
          value={action}
          onChange={(v) => (setAction(v), setPage(1))}
          w={180}
        />
        <DatePickerInput type="range" placeholder="Rango de fechas" clearable value={range} onChange={(v) => (setRange(v), setPage(1))} w={260} valueFormat="DD/MM/YYYY" />
      </Group>
      <DataTable
        data={rows.data?.items ?? []}
        columns={columns}
        loading={rows.isLoading}
        total={rows.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(r) => String(r.id)}
        onRowClick={setSelected}
      />
      <DiffModal row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function AuthAuditTab() {
  const [email, setEmail] = useState("");
  const [debounced] = useDebouncedValue(email, 350);
  const [event, setEvent] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [range, setRange] = useState<DatesRangeValue>([null, null]);
  const [page, setPage] = useState(1);

  const rows = useQuery({
    queryKey: ["admin", "audit", "auth", { debounced, event, success, range, page }],
    queryFn: () => adminApi.authAudit({ email: debounced, event, success, ...toRange(range), page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<AuthAuditRow, unknown>[]>(
    () => [
      { header: "Fecha", size: 160, cell: ({ row: { original: r } }) => <Text size="sm">{fmtDateTimeSec(r.createdAt)}</Text> },
      { header: "Correo", cell: ({ row: { original: r } }) => <Text size="sm">{r.email ?? "—"}</Text> },
      {
        header: "Evento",
        cell: ({ row: { original: r } }) => (
          <Text size="sm" c={r.eventType === "refresh_reuse" || r.eventType === "locked" ? "red" : undefined} fw={500}>
            {EVENT_LABEL[r.eventType] ?? r.eventType}
          </Text>
        )
      },
      {
        header: "Resultado",
        size: 100,
        cell: ({ row: { original: r } }) => <Badge color={r.success ? "teal" : "red"}>{r.success ? "Éxito" : "Fallo"}</Badge>
      },
      { header: "IP", cell: ({ row: { original: r } }) => <Text size="sm">{r.ipAddress ?? "—"}</Text> },
      {
        header: "Detalle",
        cell: ({ row: { original: r } }) => (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail) : ""}
          </Text>
        )
      }
    ],
    []
  );

  return (
    <>
      <Group mb="md" gap="sm">
        <TextInput placeholder="Correo" leftSection={<IconSearch size={16} />} value={email} onChange={(e) => (setEmail(e.currentTarget.value), setPage(1))} w={240} />
        <Select
          placeholder="Todos los eventos"
          clearable
          allowDeselect
          data={Object.entries(EVENT_LABEL).map(([value, label]) => ({ value, label }))}
          value={event}
          onChange={(v) => (setEvent(v), setPage(1))}
          w={240}
        />
        <Select
          placeholder="Éxito y fallo"
          clearable
          allowDeselect
          data={[
            { value: "true", label: "Solo éxitos" },
            { value: "false", label: "Solo fallos" }
          ]}
          value={success}
          onChange={(v) => (setSuccess(v), setPage(1))}
          w={160}
        />
        <DatePickerInput type="range" placeholder="Rango de fechas" clearable value={range} onChange={(v) => (setRange(v), setPage(1))} w={260} valueFormat="DD/MM/YYYY" />
      </Group>
      <DataTable
        data={rows.data?.items ?? []}
        columns={columns}
        loading={rows.isLoading}
        total={rows.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(r) => String(r.id)}
      />
    </>
  );
}

export default function AuditAdminPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Auditoría" description="Quién cambió qué, cuándo, y todos los accesos al sistema" actions={ADMIN_ACTIONS} />
      <Tabs defaultValue="data" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="data" leftSection={<IconDatabase size={16} />}>
            Cambios en datos
          </Tabs.Tab>
          <Tabs.Tab value="auth" leftSection={<IconLogin size={16} />}>
            Accesos
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="data">
          <DataAuditTab />
        </Tabs.Panel>
        <Tabs.Panel value="auth">
          <AuthAuditTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
