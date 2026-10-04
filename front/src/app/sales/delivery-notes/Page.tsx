/**
 * @project FabriHub - Front
 * @file src/app/sales/delivery-notes/Page.tsx
 * @description Ventas → Notas de entrega (SAL_DELIVERY_NOTES): por despachar, notas emitidas y trazabilidad lote → cliente
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Loader, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconBan, IconPackageExport, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { QUALITY_COLOR, QUALITY_LABEL, type QualityStatus } from "@/app/inventory/types";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { SALES_ACTIONS } from "../salesActions";
import { salesApi } from "../services/sales.service";
import { SO_STATUS_COLOR, SO_STATUS_LABEL, type Delivery, type PendingSalesOrder } from "../types";
import DeliverModal from "./DeliverModal";

const MODULE = "SAL_DELIVERY_NOTES";
const PAGE_SIZE = 20;
const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);
const fmtD = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "—");

function DeliveryDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["sales", "deliveries", id], queryFn: () => salesApi.getDelivery(id!), enabled: Boolean(id) });
  const cancel = useMutation({
    mutationFn: (reason: string) => salesApi.cancelDelivery(id!, reason),
    onSuccess: (d) => {
      notifySuccess(`Nota ${d.number} anulada: la existencia volvió al almacén`);
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => notifyError(err)
  });
  const n = detail.data;
  const askCancel = () => {
    let reason = "";
    modals.openConfirmModal({
      title: `Anular ${n?.number}`,
      children: <Textarea label="Motivo" required autosize minRows={2} autoFocus onChange={(e) => (reason = e.currentTarget.value)} />,
      labels: { confirm: "Anular", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => (reason.trim().length >= 3 ? cancel.mutate(reason.trim()) : notifyError(null, "Indique el motivo"))
    });
  };
  const margin = n && n.netAmount * n.exchangeRate - n.costAmount;

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title="Nota de entrega">
      {!n ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {n.number} <Badge color={n.status === "posted" ? "teal" : "red"}>{n.status === "posted" ? "Emitida" : "Anulada"}</Badge>
            </Title>
            <Text fw={600}>{n.customerName}</Text>
            <Text size="sm" c="dimmed">
              RIF {n.customerRif} · orden {n.orderNumber} · {fmtD(n.deliveryDate)} · desde {n.warehouseCode}
              {n.carrier ? ` · ${n.carrier}` : ""}
            </Text>
            <Text size="xs" c="dimmed">
              Despachó {n.createdBy} {fmtDateTime(n.createdAt)} · {n.movementNumber}
              {n.cancelledAt ? ` · anulada por ${n.cancelledBy} ${fmtDateTime(n.cancelledAt)}` : ""}
            </Text>
          </div>
          {n.status === "posted" && can("delete") && (
            <Button size="xs" variant="subtle" color="red" w="fit-content" leftSection={<IconBan size={14} />} loading={cancel.isPending} onClick={askCancel}>
              Anular nota (reversa la salida)
            </Button>
          )}
          {n.cancelReason && <Alert color="red" variant="light">Anulada: {n.cancelReason}</Alert>}
          <Table withTableBorder striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Producto</Table.Th>
                <Table.Th>Lote</Table.Th>
                <Table.Th ta="right">Cantidad</Table.Th>
                <Table.Th ta="right">Precio neto</Table.Th>
                <Table.Th ta="right">Costo</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {n.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{l.productCode}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>{l.productName}</Text>
                  </Table.Td>
                  <Table.Td>
                    {l.lotCode ?? "—"}
                    {l.expiresOn && <Text size="xs" c="dimmed">vence {fmtD(l.expiresOn)}</Text>}
                  </Table.Td>
                  <Table.Td ta="right">{qty(l.quantity)} {l.unitCode}</Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.unitPrice, 4)}</Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.unitCost, 4)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Stack gap={2} className="rounded-lg bg-gray-50 p-3" maw={420} ml="auto" w="100%">
            <Group justify="space-between"><Text size="sm">Venta neta ({n.currencyCode})</Text><Text size="sm">{fmtMoney(n.netAmount)}</Text></Group>
            <Group justify="space-between"><Text size="sm">Costo de lo despachado (moneda base)</Text><Text size="sm">{fmtMoney(n.costAmount)}</Text></Group>
            <Group justify="space-between">
              <Text fw={700}>Margen bruto</Text>
              <Text fw={800} c={(margin ?? 0) >= 0 ? "teal" : "red"}>
                {fmtMoney(margin)} {n.netAmount > 0 ? `(${fmtMoney(((margin ?? 0) / (n.netAmount * n.exchangeRate)) * 100, 1)} %)` : ""}
              </Text>
            </Group>
          </Stack>
          {n.notes && <Text size="sm" style={{ whiteSpace: "pre-line" }}>{n.notes}</Text>}
        </Stack>
      )}
    </Drawer>
  );
}

function PendingTab({ onDeliver }: Readonly<{ onDeliver: (id: string) => void }>) {
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["sales", "deliveries", "pending"], queryFn: salesApi.pendingOrders });
  const columns = useMemo<ColumnDef<PendingSalesOrder, unknown>[]>(
    () => [
      { header: "Orden", cell: ({ row: { original: o } }) => <Text size="sm" fw={700}>{o.number}</Text> },
      { header: "Cliente", cell: ({ row: { original: o } }) => <Text size="sm">{o.customerName}</Text> },
      {
        header: "Estado",
        cell: ({ row: { original: o } }) => (
          <Group gap={4}>
            <Badge color={SO_STATUS_COLOR[o.status]}>{SO_STATUS_LABEL[o.status]}</Badge>
            {o.isLate && <Badge color="red" variant="light">Atrasada</Badge>}
          </Group>
        )
      },
      { header: "Entrega solicitada", cell: ({ row: { original: o } }) => <Text size="sm">{fmtD(o.requestedDate)}</Text> },
      { header: "Almacén", cell: ({ row: { original: o } }) => <Text size="sm">{o.warehouseCode}</Text> },
      { header: "Líneas pendientes", cell: ({ row: { original: o } }) => <Text size="sm">{o.pendingLines}</Text> },
      {
        id: "go",
        header: "",
        cell: ({ row: { original: o } }) =>
          can("add_new") && (
            <Group justify="flex-end">
              <Button size="xs" leftSection={<IconPackageExport size={14} />} onClick={() => onDeliver(o.id)}>Despachar</Button>
            </Group>
          )
      }
    ],
    [can, onDeliver]
  );
  return <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(o) => o.id} emptyText="No hay órdenes por despachar en sus almacenes" />;
}

function NotesTab({ onOpen }: Readonly<{ onOpen: (id: string) => void }>) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["sales", "deliveries", { debounced, page }],
    queryFn: () => salesApi.listDeliveries({ search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });
  const columns = useMemo<ColumnDef<Delivery, unknown>[]>(
    () => [
      {
        header: "Nota",
        cell: ({ row: { original: n } }) => (
          <div>
            <Text size="sm" fw={700} td={n.status === "cancelled" ? "line-through" : undefined}>{n.number}</Text>
            <Text size="xs" c="dimmed">{fmtD(n.deliveryDate)}</Text>
          </div>
        )
      },
      { header: "Orden", cell: ({ row: { original: n } }) => <Text size="sm">{n.orderNumber}</Text> },
      { header: "Cliente", cell: ({ row: { original: n } }) => <Text size="sm">{n.customerName}</Text> },
      { header: "Almacén", cell: ({ row: { original: n } }) => <Text size="sm">{n.warehouseCode}</Text> },
      { header: "Venta neta", cell: ({ row: { original: n } }) => <Text size="sm" ta="right">{n.currencyCode} {fmtMoney(n.netAmount)}</Text> },
      { header: "Estado", cell: ({ row: { original: n } }) => <Badge color={n.status === "posted" ? "teal" : "red"} variant="light">{n.status === "posted" ? "Emitida" : "Anulada"}</Badge> },
      { header: "Despachó", cell: ({ row: { original: n } }) => <Text size="xs">{n.createdBy}</Text> }
    ],
    []
  );
  return (
    <>
      <Group mb="md">
        <TextInput placeholder="Nota, orden o cliente" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={280} />
      </Group>
      <DataTable data={list.data?.items ?? []} columns={columns} loading={list.isLoading} total={list.data?.total} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} rowKey={(n) => n.id} onRowClick={(n) => onOpen(n.id)} />
    </>
  );
}

/** Trazabilidad para retiros del mercado: a qué clientes llegó un lote */
function TraceTab({ onOpen }: Readonly<{ onOpen: (id: string) => void }>) {
  const [code, setCode] = useState("");
  const [debounced] = useDebouncedValue(code.trim(), 400);
  const trace = useQuery({ queryKey: ["sales", "trace", debounced], queryFn: () => salesApi.traceLot(debounced), enabled: debounced.length > 0 });
  return (
    <Stack>
      <TextInput label="Código de lote" placeholder="p. ej. L2508" leftSection={<IconSearch size={16} />} value={code} onChange={(e) => setCode(e.currentTarget.value)} maw={320} />
      {trace.isLoading && <Loader size="sm" />}
      {trace.data && trace.data.length === 0 && <Text c="dimmed">No hay lotes con ese código.</Text>}
      {trace.data?.map((t) => (
        <Stack key={t.lot.id} gap="xs" className="rounded-lg border border-gray-200 p-3">
          <Group justify="space-between">
            <div>
              <Text fw={700}>
                {t.lot.lotCode} · {t.lot.productCode} <Badge size="sm" color={QUALITY_COLOR[t.lot.qualityStatus as QualityStatus]}>{QUALITY_LABEL[t.lot.qualityStatus as QualityStatus]}</Badge>
              </Text>
              <Text size="xs" c="dimmed">
                {t.lot.productName} · vence {fmtD(t.lot.expiresOn)}
                {t.lot.productionOrderNumber ? ` · fabricado en ${t.lot.productionOrderNumber}` : ""}
                {t.lot.supplierName ? ` · proveedor ${t.lot.supplierName}` : ""}
              </Text>
            </div>
            <Badge variant="light">{t.deliveries.filter((d) => d.status === "posted").reduce((a, d) => a + d.quantity, 0)} {t.lot.unitCode} despachadas</Badge>
          </Group>
          {t.deliveries.length === 0 ? (
            <Text size="sm" c="dimmed">Este lote no se ha despachado a ningún cliente.</Text>
          ) : (
            <Table fz="sm" withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Cliente</Table.Th>
                  <Table.Th>Contacto</Table.Th>
                  <Table.Th>Nota</Table.Th>
                  <Table.Th ta="right">Cantidad</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {t.deliveries.map((d) => (
                  <Table.Tr key={d.id} style={{ cursor: "pointer" }} onClick={() => onOpen(d.id)}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{d.customerName}</Text>
                      <Text size="xs" c="dimmed">{d.customerRif}</Text>
                    </Table.Td>
                    <Table.Td><Text size="xs">{[d.phones?.join(", "), d.email].filter(Boolean).join(" · ") || "—"}</Text></Table.Td>
                    <Table.Td>
                      <Text size="sm" td={d.status === "cancelled" ? "line-through" : undefined}>{d.number} · {fmtD(d.deliveryDate)}</Text>
                      <Text size="xs" c="dimmed">{d.orderNumber}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{qty(d.quantity)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

export default function DeliveryNotesPage() {
  const [params, setParams] = useSearchParams();
  const [detailId, setDetailId] = useState<string | null>(null);
  const deliverId = params.get("deliver");
  return (
    <div className="p-6">
      <ModuleHeader title="Notas de entrega" description="Despacho FEFO de órdenes de venta y trazabilidad de lotes hasta el cliente" actions={SALES_ACTIONS} />
      <Tabs defaultValue="pending" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="pending">Por despachar</Tabs.Tab>
          <Tabs.Tab value="notes">Notas emitidas</Tabs.Tab>
          <Tabs.Tab value="trace">Trazabilidad de lote</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="pending">
          <PendingTab onDeliver={(id) => setParams({ deliver: id })} />
        </Tabs.Panel>
        <Tabs.Panel value="notes">
          <NotesTab onOpen={setDetailId} />
        </Tabs.Panel>
        <Tabs.Panel value="trace">
          <TraceTab onOpen={setDetailId} />
        </Tabs.Panel>
      </Tabs>
      <DeliverModal orderId={deliverId} onClose={() => setParams({})} onDone={(d) => setDetailId(d.id)} />
      <DeliveryDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
