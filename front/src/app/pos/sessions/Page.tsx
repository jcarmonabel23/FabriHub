/**
 * @project FabriHub - Front
 * @file src/app/pos/sessions/Page.tsx
 * @description Punto de venta → Turnos de caja (POS_SESSIONS): consulta, arqueo y cierre
 *
 * Sin view_all cada cajero ve y cierra solo sus turnos. Con view_all, un supervisor puede cerrar
 * el turno que un cajero dejó abierto.
 */

import { useMemo, useState } from "react";
import { Badge, Button, Drawer, Group, SegmentedControl, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { IconLockOpen, IconReceipt } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import CloseSessionModal from "../components/CloseSessionModal";
import { POS_ACTIONS } from "../posActions";
import { posApi } from "../services/pos.service";
import { PAYMENT_METHOD_LABEL, type PosSession } from "../types";

function SessionDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const can = useCan("POS_SESSIONS");
  const canTickets = useCan("POS_SALES")("view");
  const detail = useQuery({ queryKey: ["pos", "session", id], queryFn: () => posApi.getSession(id!), enabled: Boolean(id) });
  const [closing, setClosing] = useState(false);
  const s = detail.data;
  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title={s ? `Turno ${s.number}` : "Turno"}>
      {s && (
        <Stack>
          <Group justify="space-between">
            <div>
              <Text fw={700}>
                Caja {s.terminalCode} · {s.cashierName}
              </Text>
              <Text size="sm" c="dimmed">
                Abierto {fmtDateTime(s.openedAt)}
                {s.closedAt ? ` · cerrado ${fmtDateTime(s.closedAt)} por ${s.closedByName}` : ""}
              </Text>
            </div>
            <Badge size="lg" color={s.status === "open" ? "teal" : "gray"}>
              {s.status === "open" ? "Abierto" : "Cerrado"}
            </Badge>
          </Group>
          <SimpleGrid cols={4}>
            <Stat label="Ventas" value={String(s.totals.completed)} />
            <Stat label="Vendido" value={fmtMoney(s.totals.grandTotal)} />
            <Stat label="IVA" value={fmtMoney(s.totals.taxAmount)} />
            <Stat label="Anuladas" value={String(s.totals.voided)} />
          </SimpleGrid>
          <Table withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Medio</Table.Th>
                <Table.Th ta="right">Fondo</Table.Th>
                <Table.Th ta="right">Cobrado</Table.Th>
                <Table.Th ta="right">Vuelto</Table.Th>
                <Table.Th ta="right">Esperado</Table.Th>
                <Table.Th ta="right">Contado</Table.Th>
                <Table.Th ta="right">Diferencia</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.counts.map((c) => (
                <Table.Tr key={`${c.method}:${c.currencyId}`}>
                  <Table.Td>
                    {PAYMENT_METHOD_LABEL[c.method]} · {c.currencyCode}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(c.opening)}</Table.Td>
                  <Table.Td ta="right">{fmtMoney(c.received)}</Table.Td>
                  <Table.Td ta="right">{c.change ? `-${fmtMoney(c.change)}` : "—"}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {fmtMoney(c.expected)}
                  </Table.Td>
                  <Table.Td ta="right">{c.counted === null ? "—" : fmtMoney(c.counted)}</Table.Td>
                  <Table.Td ta="right" c={c.difference ? (c.difference < 0 ? "red" : "teal") : undefined}>
                    {c.difference === null ? "—" : fmtMoney(c.difference)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {s.status === "closed" && (
            <Text size="sm">
              Diferencia total (moneda base): <b>{fmtMoney(s.differenceTotal)}</b>
              {s.closingNotes ? ` · ${s.closingNotes}` : ""}
            </Text>
          )}
          <Group justify="flex-end">
            {canTickets && (
              <Button component={Link} to={`/pos/sales/tickets?session=${s.id}`} variant="default" leftSection={<IconReceipt size={16} />}>
                Ver sus ventas
              </Button>
            )}
            {s.status === "open" && can("close") && (
              <Button color="red" variant="light" leftSection={<IconLockOpen size={16} />} onClick={() => setClosing(true)}>
                Cerrar turno
              </Button>
            )}
          </Group>
        </Stack>
      )}
      <CloseSessionModal sessionId={closing && s ? s.id : null} onClose={() => setClosing(false)} />
    </Drawer>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border border-gray-200 p-2">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700}>{value}</Text>
    </div>
  );
}

export default function PosSessionsPage() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["pos", "sessions", status, page],
    queryFn: () => posApi.listSessions({ status: status === "all" ? undefined : status, page, pageSize: 25 }),
    placeholderData: (prev) => prev
  });

  const columns = useMemo<ColumnDef<PosSession, unknown>[]>(
    () => [
      { header: "Turno", cell: ({ row: { original: s } }) => <Text size="sm" fw={700}>{s.number}</Text> },
      { header: "Caja", cell: ({ row: { original: s } }) => <Text size="sm">{`${s.terminalCode} · ${s.terminalName}`}</Text> },
      { header: "Cajero", cell: ({ row: { original: s } }) => <Text size="sm">{s.cashierName}</Text> },
      {
        header: "Horario",
        cell: ({ row: { original: s } }) => (
          <Text size="sm">
            {fmtDateTime(s.openedAt)}
            {s.closedAt ? ` → ${fmtDateTime(s.closedAt)}` : ""}
          </Text>
        )
      },
      { header: "Ventas", cell: ({ row: { original: s } }) => <Text size="sm">{s.salesCount === null ? "—" : `${s.salesCount} · ${fmtMoney(s.salesTotal)}`}</Text> },
      {
        header: "Diferencia",
        cell: ({ row: { original: s } }) => (
          <Text size="sm" c={s.differenceTotal ? (s.differenceTotal < 0 ? "red" : "teal") : undefined}>
            {s.differenceTotal === null ? "—" : fmtMoney(s.differenceTotal)}
          </Text>
        )
      },
      {
        header: "Estado",
        size: 90,
        cell: ({ row: { original: s } }) => (
          <Badge color={s.status === "open" ? "teal" : "gray"} variant="light">
            {s.status === "open" ? "Abierto" : "Cerrado"}
          </Badge>
        )
      }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Turnos de caja" description="Apertura, arqueo y cierre de cada turno" actions={POS_ACTIONS} />
      <SegmentedControl
        mb="md"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        data={[
          { value: "all", label: "Todos" },
          { value: "open", label: "Abiertos" },
          { value: "closed", label: "Cerrados" }
        ]}
      />
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        onRowClick={(s) => setOpenId(s.id)}
        rowKey={(s) => s.id}
        emptyText="Sin turnos"
      />
      <SessionDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
