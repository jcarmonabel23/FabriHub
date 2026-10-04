/**
 * @project FabriHub - Front
 * @file src/app/inventory/lots/Page.tsx
 * @description Inventario → Lotes (INV_LOTS): trazabilidad, vencimientos y retención
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Drawer, Group, Loader, Select, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconDeviceFloppy, IconLock, IconLockOpen, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { INVENTORY_ACTIONS } from "../inventoryActions";
import { inventoryApi } from "../services/inventory.service";
import { DIRECTION_COLOR, DIRECTION_LABEL, QUALITY_COLOR, QUALITY_LABEL, type Lot, type QualityStatus } from "../types";

const MODULE = "INV_LOTS";
const PAGE_SIZE = 25;
const fmtDate = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "—");

export function ExpiryBadge({ expiresOn, days }: Readonly<{ expiresOn: string | null; days: number | null }>) {
  if (!expiresOn) return <Text size="sm">—</Text>;
  const color = days !== null && days < 0 ? "red" : days !== null && days <= 90 ? "orange" : "gray";
  return (
    <Badge color={color} variant={color === "gray" ? "outline" : "light"}>
      {fmtDate(expiresOn)}
      {days !== null && days < 0 ? " · vencido" : days !== null && days <= 90 ? ` · ${days} d` : ""}
    </Badge>
  );
}

function askReason(title: string, onConfirm: (reason: string) => void) {
  let reason = "";
  modals.openConfirmModal({
    title,
    children: <Textarea label="Motivo" required autosize minRows={2} autoFocus onChange={(e) => (reason = e.currentTarget.value)} />,
    labels: { confirm: "Confirmar", cancel: "Cancelar" },
    onConfirm: () => {
      if (reason.trim().length < 3) {
        notifyError(null, "Indique el motivo (mínimo 3 caracteres)");
        return;
      }
      onConfirm(reason.trim());
    }
  });
}

function LotDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["inventory", "lots", id], queryFn: () => inventoryApi.getLot(id!), enabled: Boolean(id) });
  const l = detail.data;
  const [f, setF] = useState({ expiresOn: null as string | null, manufacturedOn: null as string | null, bestBefore: null as string | null, supplierLot: "", description: "" });
  useEffect(() => {
    if (l) setF({ expiresOn: l.expiresOn, manufacturedOn: l.manufacturedOn, bestBefore: l.bestBefore, supplierLot: l.supplierLot ?? "", description: l.description ?? "" });
  }, [l]);

  const refresh = (data: unknown) => {
    qc.setQueryData(["inventory", "lots", id], data);
    qc.invalidateQueries({ queryKey: ["inventory", "lots"], exact: false });
  };
  const save = useMutation({
    mutationFn: () => inventoryApi.updateLot(id!, { ...f, supplierLot: f.supplierLot || null, description: f.description || null }),
    onSuccess: (d) => {
      notifySuccess("Lote actualizado");
      refresh(d);
    },
    onError: (err) => notifyError(err)
  });
  const hold = useMutation({
    mutationFn: ({ on, reason }: { on: boolean; reason: string }) => (on ? inventoryApi.holdLot(id!, reason) : inventoryApi.releaseHold(id!, reason)),
    onSuccess: (d, v) => {
      notifySuccess(v.on ? "Lote retenido: no podrá salir hasta liberarlo" : "Retención liberada");
      refresh(d);
    },
    onError: (err) => notifyError(err)
  });

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title="Lote">
      {!l ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={4}>
                {l.lotCode} <Badge color={QUALITY_COLOR[l.qualityStatus]}>{QUALITY_LABEL[l.qualityStatus]}</Badge>
              </Title>
              <Text>
                {l.productCode} · {l.productName}
              </Text>
              <Text size="sm" c="dimmed">
                Lote interno #{l.internalNumber} · existencia total {fmtMoney(l.quantity, 2)} {l.unitCode}
              </Text>
            </div>
            {can("edit") && l.qualityStatus === "approved" && (
              <Button color="orange" variant="light" leftSection={<IconLock size={16} />} onClick={() => askReason("Retener lote", (reason) => hold.mutate({ on: true, reason }))}>
                Retener
              </Button>
            )}
            {can("edit") && l.qualityStatus === "on_hold" && (
              <Button color="teal" variant="light" leftSection={<IconLockOpen size={16} />} onClick={() => askReason("Liberar retención", (reason) => hold.mutate({ on: false, reason }))}>
                Liberar retención
              </Button>
            )}
          </Group>
          {l.qualityStatus === "quarantine" && (
            <Text size="sm" c="dimmed">
              En cuarentena: lo aprueba o rechaza Calidad (módulo de la fase 4).
            </Text>
          )}

          <Group grow>
            <DateInput label="Fabricación" clearable valueFormat="DD/MM/YYYY" readOnly={!can("edit")} value={f.manufacturedOn} onChange={(v) => setF({ ...f, manufacturedOn: v })} />
            <DateInput label="Vencimiento" clearable valueFormat="DD/MM/YYYY" readOnly={!can("edit")} value={f.expiresOn} onChange={(v) => setF({ ...f, expiresOn: v })} />
            <DateInput label="Vender antes de" clearable valueFormat="DD/MM/YYYY" readOnly={!can("edit")} value={f.bestBefore} onChange={(v) => setF({ ...f, bestBefore: v })} />
          </Group>
          <Group grow>
            <TextInput label="Lote del proveedor" readOnly={!can("edit")} value={f.supplierLot} onChange={(e) => setF({ ...f, supplierLot: e.currentTarget.value })} />
            <TextInput label="Descripción" readOnly={!can("edit")} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
          </Group>
          {can("edit") && (
            <Group justify="flex-end">
              <Button leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} onClick={() => save.mutate()}>
                Guardar datos
              </Button>
            </Group>
          )}

          <Title order={6} tt="uppercase" c="petrol.8">
            Existencia por almacén
          </Title>
          <Table withTableBorder fz="sm">
            <Table.Tbody>
              {l.stock.map((s) => (
                <Table.Tr key={s.warehouseCode}>
                  <Table.Td>
                    {s.warehouseCode} · {s.warehouseName}
                  </Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {fmtMoney(s.quantity, 2)} {l.unitCode}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Title order={6} tt="uppercase" c="petrol.8">
            Trazabilidad
          </Title>
          <Table withTableBorder striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Movimiento</Table.Th>
                <Table.Th>Concepto</Table.Th>
                <Table.Th>Almacén</Table.Th>
                <Table.Th ta="right">Cantidad</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {l.history.map((h, i) => (
                <Table.Tr key={`${h.movementId}-${i}`} className={h.status === "reversed" ? "line-through opacity-60" : ""}>
                  <Table.Td>{fmtDate(h.movementDate)}</Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={DIRECTION_COLOR[h.direction]} mr={4}>
                      {DIRECTION_LABEL[h.direction]}
                    </Badge>
                    {h.number}
                  </Table.Td>
                  <Table.Td>{h.conceptName}</Table.Td>
                  <Table.Td>
                    {h.warehouseCode}
                    {h.targetWarehouseCode ? ` → ${h.targetWarehouseCode}` : ""}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(h.quantity, 2)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Drawer>
  );
}

export default function LotsPage() {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState<string | null>(null);
  const [withStock, setWithStock] = useState<string | null>("true");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["inventory", "lots", { debounced, status, withStock, page }],
    queryFn: () => inventoryApi.listLots({ search: debounced, status, withStock, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<Lot, unknown>[]>(
    () => [
      {
        header: "Lote",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm" fw={700}>
              {l.lotCode}
            </Text>
            <Text size="xs" c="dimmed">
              #{l.internalNumber}
              {l.supplierLot ? ` · prov. ${l.supplierLot}` : ""}
            </Text>
          </div>
        )
      },
      {
        header: "Producto",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm">{l.productCode}</Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {l.productName}
            </Text>
          </div>
        )
      },
      { header: "Estado", cell: ({ row: { original: l } }) => <Badge color={QUALITY_COLOR[l.qualityStatus]}>{QUALITY_LABEL[l.qualityStatus]}</Badge> },
      { header: "Vencimiento", cell: ({ row: { original: l } }) => <ExpiryBadge expiresOn={l.expiresOn} days={l.daysToExpire} /> },
      {
        header: "Existencia",
        cell: ({ row: { original: l } }) => (
          <Text size="sm" fw={600}>
            {fmtMoney(l.quantity, 2)} {l.unitCode}
          </Text>
        )
      }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Lotes" description="Trazabilidad, vencimientos y estado de calidad" actions={INVENTORY_ACTIONS} />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Lote, producto o lote del proveedor" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={300} />
        <Select
          placeholder="Todos los estados"
          clearable
          allowDeselect
          data={(Object.keys(QUALITY_LABEL) as QualityStatus[]).map((s) => ({ value: s, label: QUALITY_LABEL[s] }))}
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          w={190}
        />
        <Select
          data={[
            { value: "true", label: "Con existencia" },
            { value: "false", label: "Agotados" }
          ]}
          placeholder="Con y sin existencia"
          clearable
          allowDeselect
          value={withStock}
          onChange={(v) => (setWithStock(v), setPage(1))}
          w={190}
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
        rowKey={(l) => l.id}
        onRowClick={(l) => setDetailId(l.id)}
      />
      <LotDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
