/**
 * @project FabriHub - Front
 * @file src/app/purchases/orders/Page.tsx
 * @description Compras → Órdenes de compra (PUR_ORDERS): listado, detalle y ciclo de estados
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Chip, Drawer, Group, Loader, Progress, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconBan, IconCheck, IconInfoCircle, IconLock, IconPencil, IconPlus, IconSearch, IconSend, IconTrash, IconTruckDelivery } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { coreAuth } from "@auth/store/coreAuth";
import { useCan, useCanAccess } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney, fmtPct } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PURCHASES_ACTIONS } from "../purchasesActions";
import { purchasesApi } from "../services/purchases.service";
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, type Order, type OrderDetail, type OrderStatus } from "../types";
import OrderEditor from "./OrderEditor";

const MODULE = "PUR_ORDERS";
const PAGE_SIZE = 20;

function askReason(title: string, label: string, color: string, onConfirm: (reason: string) => void) {
  let reason = "";
  modals.openConfirmModal({
    title,
    children: <Textarea label={label} required autosize minRows={2} autoFocus onChange={(e) => (reason = e.currentTarget.value)} />,
    labels: { confirm: "Confirmar", cancel: "Cancelar" },
    confirmProps: { color },
    onConfirm: () => (reason.trim().length >= 3 ? onConfirm(reason.trim()) : notifyError(null, "Indique el motivo"))
  });
}

function OrderDrawer({ id, onClose, onEdit }: Readonly<{ id: string | null; onClose: () => void; onEdit: (o: OrderDetail) => void }>) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const can = useCan(MODULE);
  const canAccess = useCanAccess();
  const me = coreAuth((s) => s.user?.id);
  const detail = useQuery({ queryKey: ["purchases", "orders", id], queryFn: () => purchasesApi.getOrder(id!), enabled: Boolean(id) });
  const o = detail.data;

  const act = useMutation({
    mutationFn: ({ action, body }: { action: Parameters<typeof purchasesApi.transition>[1]; body?: Record<string, unknown> }) => purchasesApi.transition(id!, action, body),
    onSuccess: (data) => {
      notifySuccess(`Orden ${data.number}: ${ORDER_STATUS_LABEL[data.status].toLowerCase()}`);
      qc.setQueryData(["purchases", "orders", id], data);
      qc.invalidateQueries({ queryKey: ["purchases", "orders"] });
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({
    mutationFn: () => purchasesApi.deleteOrder(id!),
    onSuccess: () => {
      notifySuccess("Borrador eliminado");
      qc.invalidateQueries({ queryKey: ["purchases", "orders"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  if (!id) return null;
  const st = o?.status;
  const isCreator = o?.createdById === me;
  const received = o ? o.lines.reduce((a, l) => a + Math.min(l.quantityReceived, l.quantity) / l.quantity, 0) / Math.max(o.lines.length, 1) : 0;

  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title="Orden de compra">
      {!o ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={4}>
                {o.number} <Badge color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </Title>
              <Text fw={600}>{o.supplierName}</Text>
              <Text size="sm" c="dimmed">
                RIF {o.supplierRif} · {dayjs(o.orderDate).format("DD/MM/YYYY")} · recibe en {o.warehouseCode} · {o.currencyCode}
                {o.exchangeRate !== 1 ? ` (tasa ${fmtMoney(o.exchangeRate, 4)})` : ""}
              </Text>
              <Text size="xs" c="dimmed">
                Creada por {o.createdBy ?? "—"} · {fmtDateTime(o.createdAt)}
                {o.approvedAt ? ` · aprobada${o.approvedBy ? ` por ${o.approvedBy}` : " automáticamente"} ${fmtDateTime(o.approvedAt)}` : ""}
              </Text>
            </div>
          </Group>

          <Group gap="xs">
            {st === "draft" && can("edit") && (
              <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => onEdit(o)}>
                Editar
              </Button>
            )}
            {st === "draft" && can("edit") && (
              <Button size="xs" leftSection={<IconSend size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "submit" })}>
                Enviar a aprobación
              </Button>
            )}
            {st === "draft" && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => modals.openConfirmModal({ title: "Eliminar borrador", children: <Text size="sm">¿Eliminar el borrador {o.number}?</Text>, labels: { confirm: "Eliminar", cancel: "Cancelar" }, confirmProps: { color: "red" }, onConfirm: () => remove.mutate() })}>
                Eliminar
              </Button>
            )}
            {st === "pending_approval" && can("approve") && (
              <>
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} disabled={isCreator} loading={act.isPending} onClick={() => act.mutate({ action: "approve", body: {} })}>
                  Aprobar
                </Button>
                <Button size="xs" variant="light" leftSection={<IconArrowBackUp size={14} />} onClick={() => askReason("Devolver a borrador", "Qué debe corregirse", "orange", (reason) => act.mutate({ action: "return-to-draft", body: { reason } }))}>
                  Devolver
                </Button>
              </>
            )}
            {(st === "approved" || st === "partially_received") && canAccess("PUR_RECEPTIONS") && (
              <Button size="xs" leftSection={<IconTruckDelivery size={14} />} onClick={() => navigate(`/purchases/receptions?receive=${o.id}`)}>
                Recibir
              </Button>
            )}
            {st === "partially_received" && can("close") && (
              <Button size="xs" variant="light" color="dark" leftSection={<IconLock size={14} />} onClick={() => askReason("Cerrar con pendientes", "Por qué no se recibirá lo pendiente", "dark", (reason) => act.mutate({ action: "close", body: { reason } }))}>
                Cerrar
              </Button>
            )}
            {(st === "draft" || st === "pending_approval" || st === "approved") && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={14} />} onClick={() => askReason("Anular orden", "Motivo de la anulación", "red", (reason) => act.mutate({ action: "cancel", body: { reason } }))}>
                Anular
              </Button>
            )}
          </Group>
          {st === "pending_approval" && isCreator && can("approve") && (
            <Alert variant="light" color="yellow" icon={<IconInfoCircle size={18} />}>
              Usted creó esta orden: por segregación de funciones debe aprobarla otra persona.
            </Alert>
          )}
          {o.cancelReason && (
            <Alert variant="light" color="red">
              Anulada: {o.cancelReason}
            </Alert>
          )}
          {(st === "partially_received" || st === "received" || st === "closed") && (
            <div>
              <Text size="xs" c="dimmed">
                Recibido {Math.round(received * 100)}%
              </Text>
              <Progress value={received * 100} color={st === "received" ? "teal" : "orange"} />
            </div>
          )}

          <Table withTableBorder striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Producto</Table.Th>
                <Table.Th ta="right">Cantidad</Table.Th>
                <Table.Th ta="right">Precio</Table.Th>
                <Table.Th ta="right">IVA</Table.Th>
                <Table.Th ta="right">Neto</Table.Th>
                <Table.Th ta="right">Recibido</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {o.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {l.productCode}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {l.productName}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    {fmtMoney(l.quantity, 2)} {l.unitCode}
                  </Table.Td>
                  <Table.Td ta="right">
                    {fmtMoney(l.unitPrice, 4)}
                    {l.discountPct > 0 && (
                      <Text size="xs" c="dimmed">
                        − {fmtPct(l.discountPct)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{fmtPct(l.taxRate)}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {fmtMoney(l.netAmount)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" c={l.quantityPending > 0 ? "orange" : "teal"}>
                      {fmtMoney(l.quantityReceived, 2)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Stack gap={2} className="rounded-lg bg-gray-50 p-3" maw={420} ml="auto" w="100%">
            <Group justify="space-between">
              <Text size="sm">Base imponible</Text>
              <Text size="sm">{fmtMoney(o.taxableAmount)}</Text>
            </Group>
            {o.taxesDetail.taxes.map((x) => (
              <Group key={x.rate} justify="space-between">
                <Text size="sm">IVA {fmtPct(x.rate)}</Text>
                <Text size="sm">{fmtMoney(x.amount)}</Text>
              </Group>
            ))}
            <Group justify="space-between">
              <Text fw={700}>Total {o.currencyCode}</Text>
              <Text fw={800} ff="monospace">
                {fmtMoney(o.total)}
              </Text>
            </Group>
            {o.taxesDetail.withholdings.map((w) => (
              <Group key={w.rateId} justify="space-between">
                <Text size="sm" c="red">
                  {w.label}
                </Text>
                <Text size="sm" c="red">
                  − {fmtMoney(w.amount)}
                </Text>
              </Group>
            ))}
            {o.withholdingAmount > 0 && (
              <Group justify="space-between">
                <Text fw={700}>Neto a pagar</Text>
                <Text fw={800} ff="monospace">
                  {fmtMoney(o.payable)}
                </Text>
              </Group>
            )}
          </Stack>

          {o.receptions.length > 0 && (
            <div>
              <Title order={6} tt="uppercase" c="petrol.8" mb="xs">
                Recepciones y devoluciones
              </Title>
              {o.receptions.map((r) => (
                <Text key={r.id} size="sm" td={r.status === "cancelled" ? "line-through" : undefined}>
                  <Badge size="xs" color={r.kind === "return" ? "red" : "teal"} mr={6}>
                    {r.kind === "return" ? "Devolución" : "Recepción"}
                  </Badge>
                  {r.number} · {dayjs(r.receptionDate).format("DD/MM/YYYY")} · {r.lines} línea(s) · {r.createdBy}
                  {r.movementNumber ? ` · ${r.movementNumber}` : ""}
                </Text>
              ))}
            </div>
          )}
          {o.notes && (
            <Text size="sm" style={{ whiteSpace: "pre-line" }}>
              {o.notes}
            </Text>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "draft", label: "Borradores" },
  { value: "pending_approval", label: "Por aprobar" },
  { value: "approved,partially_received", label: "Por recibir" },
  { value: "received,closed", label: "Completadas" },
  { value: "cancelled", label: "Anuladas" }
];

export default function OrdersPage() {
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; order: OrderDetail | null }>({ open: false, order: null });

  const list = useQuery({
    queryKey: ["purchases", "orders", { debounced, status, page }],
    queryFn: () => purchasesApi.listOrders({ search: debounced, status: status || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      {
        header: "Orden",
        cell: ({ row: { original: o } }) => (
          <div>
            <Text size="sm" fw={700}>
              {o.number}
            </Text>
            <Text size="xs" c="dimmed">
              {dayjs(o.orderDate).format("DD/MM/YYYY")}
            </Text>
          </div>
        )
      },
      { header: "Proveedor", cell: ({ row: { original: o } }) => <Text size="sm">{o.supplierName}</Text> },
      { header: "Estado", cell: ({ row: { original: o } }) => <Badge color={ORDER_STATUS_COLOR[o.status as OrderStatus]}>{ORDER_STATUS_LABEL[o.status as OrderStatus]}</Badge> },
      { header: "Se espera", cell: ({ row: { original: o } }) => <Text size="sm">{o.expectedDate ? dayjs(o.expectedDate).format("DD/MM/YYYY") : "—"}</Text> },
      {
        header: "Total",
        cell: ({ row: { original: o } }) => (
          <Text size="sm" fw={600} ta="right">
            {o.currencySymbol} {fmtMoney(o.total)}
          </Text>
        )
      },
      { header: "Creada por", cell: ({ row: { original: o } }) => <Text size="xs">{o.createdBy ?? "—"}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Órdenes de compra"
        description="Borrador → aprobación → recepción. Quien crea no aprueba."
        actions={PURCHASES_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditor({ open: true, order: null })}>
              Nueva orden
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Número, proveedor o referencia" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={280} />
        <Chip.Group multiple={false} value={status} onChange={(v) => (setStatus(v as string), setPage(1))}>
          <Group gap={6}>
            {FILTERS.map((f) => (
              <Chip key={f.value} value={f.value} size="sm" variant="light">
                {f.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(o) => o.id}
        onRowClick={(o) => setDetailId(o.id)}
      />
      <OrderEditor opened={editor.open} order={editor.order} onClose={() => setEditor({ open: false, order: null })} onSaved={(o) => setDetailId(o.id)} />
      <OrderDrawer id={detailId} onClose={() => setDetailId(null)} onEdit={(o) => setEditor({ open: true, order: o })} />
    </div>
  );
}
