/**
 * @project FabriHub - Front
 * @file src/app/sales/orders/Page.tsx
 * @description Ventas → Órdenes de venta (SAL_ORDERS): listado, detalle, crédito, reservas FEFO y despacho
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Chip, Drawer, Group, Loader, Progress, Stack, Table, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconBan, IconCheck, IconInfoCircle, IconLock, IconPackageExport, IconPencil, IconPlus, IconRefresh, IconSearch, IconSend, IconTrash } from "@tabler/icons-react";
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
import { SALES_ACTIONS } from "../salesActions";
import { salesApi, type SalesAction } from "../services/sales.service";
import { SO_STATUS_COLOR, SO_STATUS_LABEL, type Backorder, type SalesOrder, type SalesOrderDetail } from "../types";
import SalesOrderEditor from "./OrderEditor";

const MODULE = "SAL_ORDERS";
const PAGE_SIZE = 20;
const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);
const fmtD = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "—");

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

function OrderDrawer({ id, onClose, onEdit }: Readonly<{ id: string | null; onClose: () => void; onEdit: (o: SalesOrderDetail) => void }>) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const can = useCan(MODULE);
  const canAccess = useCanAccess();
  const me = coreAuth((s) => s.user?.id);
  const detail = useQuery({ queryKey: ["sales", "orders", id], queryFn: () => salesApi.getOrder(id!), enabled: Boolean(id) });
  const [backorder, setBackorder] = useState<Backorder[] | null>(null);
  const o = detail.data;

  const act = useMutation({
    mutationFn: ({ action, body }: { action: SalesAction; body?: Record<string, unknown> }) => salesApi.act(id!, action, body),
    onSuccess: (data) => {
      if (data.creditHold) notifyError(null, `${data.number}: excede el límite de crédito; queda retenida para aprobación`);
      else notifySuccess(`Orden ${data.number}: ${SO_STATUS_LABEL[data.status].toLowerCase()}`);
      setBackorder(data.backorder?.length ? data.backorder : null);
      qc.setQueryData(["sales", "orders", id], data);
      qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({
    mutationFn: () => salesApi.deleteOrder(id!),
    onSuccess: () => {
      notifySuccess("Borrador eliminado");
      qc.invalidateQueries({ queryKey: ["sales", "orders"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  if (!id) return null;
  const st = o?.status;
  const isCreator = o?.createdById === me;
  const delivered = o ? o.lines.reduce((a, l) => a + Math.min(l.quantityDelivered, l.quantity) / l.quantity, 0) / Math.max(o.lines.length, 1) : 0;
  const missing = o?.lines.some((l) => l.isStockable && l.quantityPending - l.quantityReserved > 1e-6) ?? false;

  return (
    <Drawer opened onClose={() => (setBackorder(null), onClose())} position="right" size="xl" title="Orden de venta">
      {!o ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {o.number} <Badge color={SO_STATUS_COLOR[o.status]}>{SO_STATUS_LABEL[o.status]}</Badge> {o.isLate && <Badge color="red" variant="light">Atrasada</Badge>}
            </Title>
            <Text fw={600}>{o.customerName}</Text>
            <Text size="sm" c="dimmed">
              RIF {o.customerRif} · {fmtD(o.orderDate)} · despacha {o.warehouseCode} · {o.currencyCode}
              {o.exchangeRate !== 1 ? ` (tasa ${fmtMoney(o.exchangeRate, 4)})` : ""}
              {o.sellerName ? ` · vendedor ${o.sellerName}` : ""}
            </Text>
            <Text size="xs" c="dimmed">
              Creada por {o.createdBy ?? "—"} · {fmtDateTime(o.createdAt)}
              {o.approvedAt ? ` · crédito aprobado por ${o.approvedBy} ${fmtDateTime(o.approvedAt)}` : ""}
              {o.customerReference ? ` · ref. cliente ${o.customerReference}` : ""}
            </Text>
          </div>

          <Group gap="xs">
            {st === "draft" && can("edit") && (
              <>
                <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => onEdit(o)}>Editar</Button>
                <Button size="xs" leftSection={<IconSend size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "confirm" })}>Confirmar y reservar</Button>
              </>
            )}
            {st === "draft" && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => modals.openConfirmModal({ title: "Eliminar borrador", children: <Text size="sm">¿Eliminar el borrador {o.number}?</Text>, labels: { confirm: "Eliminar", cancel: "Cancelar" }, confirmProps: { color: "red" }, onConfirm: () => remove.mutate() })}>
                Eliminar
              </Button>
            )}
            {st === "pending_approval" && can("approve") && (
              <>
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} disabled={isCreator} loading={act.isPending} onClick={() => act.mutate({ action: "approve" })}>Aprobar crédito</Button>
                <Button size="xs" variant="light" leftSection={<IconArrowBackUp size={14} />} onClick={() => askReason("Rechazar crédito", "Motivo (vuelve a borrador)", "orange", (reason) => act.mutate({ action: "return-to-draft", body: { reason } }))}>
                  Devolver
                </Button>
              </>
            )}
            {(st === "confirmed" || st === "partially_delivered") && canAccess("SAL_DELIVERY_NOTES") && (
              <Button size="xs" leftSection={<IconPackageExport size={14} />} onClick={() => navigate(`/sales/delivery-notes?deliver=${o.id}`)}>Despachar</Button>
            )}
            {(st === "confirmed" || st === "partially_delivered") && can("edit") && missing && (
              <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "reserve" })}>Reservar pendiente</Button>
            )}
            {st === "partially_delivered" && can("close") && (
              <Button size="xs" variant="light" color="dark" leftSection={<IconLock size={14} />} onClick={() => askReason("Cerrar con pendientes", "Por qué no se despachará lo pendiente", "dark", (reason) => act.mutate({ action: "close", body: { reason } }))}>Cerrar</Button>
            )}
            {(st === "draft" || st === "pending_approval" || st === "confirmed") && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={14} />} onClick={() => askReason("Anular orden", "Motivo de la anulación", "red", (reason) => act.mutate({ action: "cancel", body: { reason } }))}>Anular</Button>
            )}
          </Group>

          {st === "pending_approval" && (
            <Alert variant="light" color="yellow" icon={<IconInfoCircle size={18} />}>
              Excede el límite de crédito del cliente ({fmtMoney(o.creditLimit ?? 0)}): con esta orden quedaría en {fmtMoney(o.creditExposure ?? 0)}.
              {isCreator && can("approve") ? " Usted la creó: por segregación de funciones debe aprobarla otra persona." : " Debe aprobarla alguien con permiso de aprobación."}
            </Alert>
          )}
          {backorder && (
            <Alert variant="light" color="orange" title="Pedido pendiente (BackOrder)">
              {backorder.map((b) => `${b.productCode}: faltan ${qty(b.missing)}`).join(" · ")}. Use «Reservar pendiente» cuando entre existencia.
            </Alert>
          )}
          {o.cancelReason && <Alert variant="light" color="red">Anulada: {o.cancelReason}</Alert>}
          {(st === "partially_delivered" || st === "delivered" || st === "closed") && (
            <div>
              <Text size="xs" c="dimmed">Despachado {Math.round(delivered * 100)}%</Text>
              <Progress value={delivered * 100} color={st === "delivered" ? "teal" : "orange"} />
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
                <Table.Th ta="right">Reservado</Table.Th>
                <Table.Th ta="right">Despachado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {o.lines.map((l) => {
                const short = l.isStockable && (st === "confirmed" || st === "partially_delivered") && l.quantityPending - l.quantityReserved > 1e-6;
                return (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{l.productCode}</Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>{l.productName}</Text>
                      {l.reservations.length > 0 && <Text size="xs" c="violet">{l.reservations.map((r) => `${r.lotCode ?? "sin lote"}: ${qty(r.quantity)}`).join(" · ")}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">{qty(l.quantity)} {l.unitCode}</Table.Td>
                    <Table.Td ta="right">
                      {fmtMoney(l.unitPrice, 4)}
                      {l.priceSource === "promo" && <Badge size="xs" color="pink" variant="light" ml={4}>promo</Badge>}
                      {l.discountPct > 0 && <Text size="xs" c="dimmed">− {fmtPct(l.discountPct)}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">{fmtPct(l.taxRate)}</Table.Td>
                    <Table.Td ta="right" fw={600}>{fmtMoney(l.netAmount)}</Table.Td>
                    <Table.Td ta="right">
                      <Tooltip label={`Disponible sin reservar en ${o.warehouseCode}: ${qty(l.available)}`}>
                        <Text size="sm" c={short ? "orange" : undefined} fw={short ? 700 : undefined}>{qty(l.quantityReserved)}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" c={l.quantityPending > 0 ? undefined : "teal"}>{qty(l.quantityDelivered)}</Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>

          <Stack gap={2} className="rounded-lg bg-gray-50 p-3" maw={420} ml="auto" w="100%">
            <Group justify="space-between"><Text size="sm">Base imponible</Text><Text size="sm">{fmtMoney(o.taxableAmount)}</Text></Group>
            {o.taxesDetail.taxes.map((x) => (
              <Group key={x.rate} justify="space-between"><Text size="sm">IVA {fmtPct(x.rate)}</Text><Text size="sm">{fmtMoney(x.amount)}</Text></Group>
            ))}
            <Group justify="space-between">
              <Text fw={700}>Total {o.currencyCode}</Text>
              <Text fw={800} ff="monospace">{fmtMoney(o.total)}</Text>
            </Group>
            {o.taxesDetail.withholdings.map((w) => (
              <Group key={w.rateId} justify="space-between">
                <Text size="sm" c="red">Retiene el cliente: {w.label}</Text>
                <Text size="sm" c="red">− {fmtMoney(w.amount)}</Text>
              </Group>
            ))}
            {o.withholdingAmount > 0 && (
              <Group justify="space-between"><Text fw={700}>Neto a cobrar</Text><Text fw={800} ff="monospace">{fmtMoney(o.receivable)}</Text></Group>
            )}
          </Stack>

          {o.deliveries.length > 0 && (
            <div>
              <Title order={6} tt="uppercase" c="petrol.8" mb="xs">Notas de entrega</Title>
              {o.deliveries.map((d) => (
                <Text key={d.id} size="sm" td={d.status === "cancelled" ? "line-through" : undefined}>
                  {d.number} · {fmtD(d.deliveryDate)} · {d.lines} línea(s) · {fmtMoney(d.netAmount)} · {d.createdBy}
                  {d.movementNumber ? ` · ${d.movementNumber}` : ""}
                </Text>
              ))}
            </div>
          )}
          {o.notes && <Text size="sm" style={{ whiteSpace: "pre-line" }}>{o.notes}</Text>}
        </Stack>
      )}
    </Drawer>
  );
}

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "draft", label: "Borradores" },
  { value: "pending_approval", label: "Retenidas" },
  { value: "confirmed,partially_delivered", label: "Por despachar" },
  { value: "delivered,closed", label: "Completadas" },
  { value: "cancelled", label: "Anuladas" }
];

export default function SalesOrdersPage() {
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; order: SalesOrderDetail | null }>({ open: false, order: null });

  const list = useQuery({
    queryKey: ["sales", "orders", { debounced, status, page }],
    queryFn: () => salesApi.listOrders({ search: debounced, status: status || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<SalesOrder, unknown>[]>(
    () => [
      {
        header: "Orden",
        cell: ({ row: { original: o } }) => (
          <div>
            <Text size="sm" fw={700}>{o.number}</Text>
            <Text size="xs" c="dimmed">{fmtD(o.orderDate)}</Text>
          </div>
        )
      },
      {
        header: "Cliente",
        cell: ({ row: { original: o } }) => (
          <div>
            <Text size="sm">{o.customerName}</Text>
            <Text size="xs" c="dimmed">{o.sellerName ?? ""}</Text>
          </div>
        )
      },
      {
        header: "Estado",
        cell: ({ row: { original: o } }) => (
          <Group gap={4}>
            <Badge color={SO_STATUS_COLOR[o.status]}>{SO_STATUS_LABEL[o.status]}</Badge>
            {o.isLate && <Badge color="red" variant="light">Atrasada</Badge>}
          </Group>
        )
      },
      { header: "Entrega", cell: ({ row: { original: o } }) => <Text size="sm">{fmtD(o.requestedDate)}</Text> },
      { header: "Total", cell: ({ row: { original: o } }) => <Text size="sm" fw={600} ta="right">{o.currencySymbol} {fmtMoney(o.total)}</Text> },
      { header: "Creada por", cell: ({ row: { original: o } }) => <Text size="xs">{o.createdBy ?? "—"}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Órdenes de venta"
        description="Borrador → confirmación (crédito y reserva FEFO) → despacho"
        actions={SALES_ACTIONS}
        right={can("add_new") && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditor({ open: true, order: null })}>Nueva orden</Button>}
      />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Número, cliente o referencia" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={280} />
        <Chip.Group multiple={false} value={status} onChange={(v) => (setStatus(v as string), setPage(1))}>
          <Group gap={6}>
            {FILTERS.map((f) => (
              <Chip key={f.value} value={f.value} size="sm" variant="light">{f.label}</Chip>
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
      <SalesOrderEditor opened={editor.open} order={editor.order} onClose={() => setEditor({ open: false, order: null })} onSaved={(o) => setDetailId(o.id)} />
      <OrderDrawer id={detailId} onClose={() => setDetailId(null)} onEdit={(o) => setEditor({ open: true, order: o })} />
    </div>
  );
}
