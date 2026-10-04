/**
 * @project FabriHub - Front
 * @file src/app/purchases/receptions/Page.tsx
 * @description Compras → Recepciones (PUR_RECEPTIONS): recibir, anular y devolver al proveedor
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Drawer, Group, Loader, Modal, NumberInput, Select, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconBan, IconSearch, IconTruckDelivery } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { QUALITY_COLOR, QUALITY_LABEL, type QualityStatus } from "@/app/inventory/types";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PURCHASES_ACTIONS } from "../purchasesActions";
import { purchasesApi } from "../services/purchases.service";
import type { Reception, ReceptionDetail } from "../types";
import ReceiveModal from "./ReceiveModal";

const MODULE = "PUR_RECEPTIONS";
const PAGE_SIZE = 25;

function ReturnModal({ rec, onClose, onDone }: Readonly<{ rec: ReceptionDetail | null; onClose: () => void; onDone: (r: ReceptionDetail) => void }>) {
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, number | string>>({});
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setQty({});
    setNotes("");
  }, [rec]);
  const chosen = (rec?.lines ?? []).filter((l) => Number(qty[l.id]) > 0);
  const save = useMutation({
    mutationFn: () =>
      purchasesApi.returnToSupplier(rec!.id, { returnDate: dayjs().format("YYYY-MM-DD"), notes, lines: chosen.map((l) => ({ receptionLineId: l.id, quantity: Number(qty[l.id]) })) }),
    onSuccess: (r) => {
      notifySuccess(`Devolución ${r.number} registrada`);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onDone(r);
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <Modal opened={Boolean(rec)} onClose={onClose} title={`Devolver al proveedor · ${rec?.number ?? ""}`} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Saca la mercancía del inventario (aunque el lote esté rechazado) y descuenta lo recibido en la orden.
        </Text>
        <Table withTableBorder fz="sm">
          <Table.Tbody>
            {(rec?.lines ?? []).map((l) => {
              const max = l.quantity - l.returned;
              return (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {l.productCode} {l.lotCode ? `· ${l.lotCode}` : ""}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Recibido {fmtMoney(l.quantity, 2)} {l.unitCode}
                      {l.returned ? ` · devuelto ${fmtMoney(l.returned, 2)}` : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td w={150}>
                    <NumberInput size="xs" min={0} max={max} disabled={max <= 0} decimalSeparator="," value={qty[l.id] ?? ""} onChange={(v) => setQty({ ...qty, [l.id]: v })} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Textarea label="Motivo" required autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button color="red" loading={save.isPending} disabled={chosen.length === 0 || notes.trim().length < 3} onClick={() => save.mutate()}>
            Registrar devolución
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ReceptionDrawer({ id, onClose, onOpen }: Readonly<{ id: string | null; onClose: () => void; onOpen: (id: string) => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["purchases", "receptions", id], queryFn: () => purchasesApi.getReception(id!), enabled: Boolean(id) });
  const [returning, setReturning] = useState<ReceptionDetail | null>(null);
  const r = detail.data;
  const cancel = useMutation({
    mutationFn: (reason: string) => purchasesApi.cancelReception(id!, reason),
    onSuccess: (data) => {
      notifySuccess(`${data.number} anulada; su movimiento de inventario se reversó`);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => notifyError(err, "No se pudo anular")
  });
  const confirmCancel = () => {
    let reason = "";
    modals.openConfirmModal({
      title: `Anular ${r?.number}`,
      children: <Textarea label="Motivo" autosize minRows={2} autoFocus onChange={(e) => (reason = e.currentTarget.value)} />,
      labels: { confirm: "Anular", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => (reason.trim().length >= 3 ? cancel.mutate(reason.trim()) : notifyError(null, "Indique el motivo"))
    });
  };

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title={r?.kind === "return" ? "Devolución a proveedor" : "Recepción"}>
      {!r ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {r.number} <Badge color={r.kind === "return" ? "red" : "teal"}>{r.kind === "return" ? "Devolución" : "Recepción"}</Badge>{" "}
              {r.status === "cancelled" && <Badge color="gray">Anulada</Badge>}
            </Title>
            <Text fw={600}>
              {r.supplierName} · {r.orderNumber}
            </Text>
            <Text size="sm" c="dimmed">
              {dayjs(r.receptionDate).format("DD/MM/YYYY")} · {r.warehouseCode}
              {r.deliveryNote ? ` · NE ${r.deliveryNote}` : ""}
              {r.movementNumber ? ` · ${r.movementNumber}` : ""} · {r.createdBy}
            </Text>
            {r.returnedReceptionNumber && (
              <Button variant="subtle" size="compact-sm" onClick={() => onOpen(r.returnedReceptionId!)}>
                De la recepción {r.returnedReceptionNumber}
              </Button>
            )}
            {r.cancelledAt && (
              <Text size="sm" c="red">
                Anulada por {r.cancelledBy} · {fmtDateTime(r.cancelledAt)}
              </Text>
            )}
          </div>
          {r.status === "posted" && (
            <Group gap="xs">
              {r.kind === "receipt" && can("add_new") && (
                <Button size="xs" variant="light" color="red" leftSection={<IconArrowBackUp size={14} />} onClick={() => setReturning(r)}>
                  Devolver al proveedor
                </Button>
              )}
              {can("delete") && (
                <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={14} />} loading={cancel.isPending} onClick={confirmCancel}>
                  Anular
                </Button>
              )}
            </Group>
          )}
          <Table withTableBorder striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Producto</Table.Th>
                <Table.Th>Lote</Table.Th>
                <Table.Th ta="right">Cantidad</Table.Th>
                <Table.Th ta="right">Costo / u. almacén</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {r.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {l.productCode}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {l.productName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {l.lotCode ? (
                      <Group gap={4}>
                        <Text size="sm">{l.lotCode}</Text>
                        {l.lotStatus && (
                          <Badge size="xs" color={QUALITY_COLOR[l.lotStatus as QualityStatus]}>
                            {QUALITY_LABEL[l.lotStatus as QualityStatus]}
                          </Badge>
                        )}
                      </Group>
                    ) : (
                      "—"
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    {fmtMoney(l.quantity, 2)} {l.unitCode}
                    {l.stockQuantity !== l.quantity && (
                      <Text size="xs" c="dimmed">
                        = {fmtMoney(l.stockQuantity, 2)} {l.stockUnitCode}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.unitCost, 4)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text ta="right" fw={700}>
            Costo total (moneda base): {fmtMoney(r.totalCost)}
          </Text>
        </Stack>
      )}
      <ReturnModal rec={returning} onClose={() => setReturning(null)} onDone={(x) => onOpen(x.id)} />
    </Drawer>
  );
}

export default function ReceptionsPage() {
  const can = useCan(MODULE);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [kind, setKind] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const receiveId = params.get("receive");

  const pending = useQuery({ queryKey: ["purchases", "pending-orders"], queryFn: purchasesApi.pendingOrders, enabled: can("add_new") });
  const list = useQuery({
    queryKey: ["purchases", "receptions", { debounced, kind, page }],
    queryFn: () => purchasesApi.listReceptions({ search: debounced, kind, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<Reception, unknown>[]>(
    () => [
      {
        header: "Número",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={700} td={r.status === "cancelled" ? "line-through" : undefined}>
              {r.number}
            </Text>
            <Text size="xs" c="dimmed">
              {dayjs(r.receptionDate).format("DD/MM/YYYY")}
            </Text>
          </div>
        )
      },
      { header: "Tipo", cell: ({ row: { original: r } }) => <Badge color={r.kind === "return" ? "red" : "teal"}>{r.kind === "return" ? "Devolución" : "Recepción"}</Badge> },
      { header: "Orden", cell: ({ row: { original: r } }) => <Text size="sm">{r.orderNumber}</Text> },
      { header: "Proveedor", cell: ({ row: { original: r } }) => <Text size="sm">{r.supplierName}</Text> },
      { header: "Almacén", size: 80, cell: ({ row: { original: r } }) => <Text size="sm">{r.warehouseCode}</Text> },
      { header: "Costo", cell: ({ row: { original: r } }) => <Text size="sm" ta="right" fw={600}>{fmtMoney(r.totalCost)}</Text> },
      { header: "Registró", cell: ({ row: { original: r } }) => <Text size="xs">{r.createdBy}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Recepciones"
        description="Entrada de mercancía contra órdenes aprobadas; los lotes entran en cuarentena"
        actions={PURCHASES_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconTruckDelivery size={16} />} onClick={() => setPicker(true)}>
              Recibir orden {pending.data?.length ? `(${pending.data.length})` : ""}
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Número, orden, nota de entrega o proveedor" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={320} />
        <Select
          placeholder="Recepciones y devoluciones"
          clearable
          allowDeselect
          data={[
            { value: "receipt", label: "Recepciones" },
            { value: "return", label: "Devoluciones" }
          ]}
          value={kind}
          onChange={(v) => (setKind(v), setPage(1))}
          w={230}
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
        rowKey={(r) => r.id}
        onRowClick={(r) => setDetailId(r.id)}
      />

      <Modal opened={picker} onClose={() => setPicker(false)} title="Órdenes pendientes por recibir" size="lg">
        <Stack gap="xs">
          {(pending.data ?? []).length === 0 && (
            <Text size="sm" c="dimmed">
              No hay órdenes aprobadas pendientes en sus almacenes.
            </Text>
          )}
          {(pending.data ?? []).map((p) => (
            <Button
              key={p.id}
              variant="light"
              justify="space-between"
              fullWidth
              h="auto"
              py={8}
              onClick={() => {
                setPicker(false);
                setParams({ receive: p.id });
              }}
              rightSection={<Badge>{p.pendingLines} pend.</Badge>}
            >
              <div className="text-left">
                <Text size="sm" fw={700}>
                  {p.number} · {p.supplierName}
                </Text>
                <Text size="xs" c="dimmed">
                  {p.warehouseCode} · se espera {p.expectedDate ? dayjs(p.expectedDate).format("DD/MM/YYYY") : "—"}
                </Text>
              </div>
            </Button>
          ))}
        </Stack>
      </Modal>
      <ReceiveModal orderId={receiveId} onClose={() => setParams({})} onDone={(r) => setDetailId(r.id)} />
      <ReceptionDrawer id={detailId} onClose={() => setDetailId(null)} onOpen={setDetailId} />
    </div>
  );
}
