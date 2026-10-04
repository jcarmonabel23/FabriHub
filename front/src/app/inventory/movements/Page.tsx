/**
 * @project FabriHub - Front
 * @file src/app/inventory/movements/Page.tsx
 * @description Inventario → Movimientos (INV_MOVEMENTS): listado, detalle, alta y reverso
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Loader, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { DatePickerInput, type DatesRangeValue } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconInfoCircle, IconPlus, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { settingsApi } from "@/app/settings/services/settings.service";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { INVENTORY_ACTIONS } from "../inventoryActions";
import { inventoryApi } from "../services/inventory.service";
import { DIRECTION_COLOR, DIRECTION_LABEL, type Movement } from "../types";
import NewMovementModal from "./NewMovementModal";

const MODULE = "INV_MOVEMENTS";
const PAGE_SIZE = 25;

function MovementDrawer({ id, onClose, onOpen }: Readonly<{ id: string | null; onClose: () => void; onOpen: (id: string) => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["inventory", "movements", id], queryFn: () => inventoryApi.getMovement(id!), enabled: Boolean(id) });
  const m = detail.data;

  const reverse = useMutation({
    mutationFn: () => inventoryApi.reverseMovement(id!),
    onSuccess: (r) => {
      notifySuccess(`Reversado con ${r.number}`);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onOpen(r.id);
    },
    onError: (err) => notifyError(err, "No se pudo reversar")
  });

  const confirmReverse = () =>
    modals.openConfirmModal({
      title: `Reversar ${m?.number}`,
      children: (
        <Text size="sm">
          Se registrará un movimiento de efecto contrario, con fecha de hoy y al <b>mismo costo</b> del original. El original queda
          marcado como reversado. No se puede deshacer.
        </Text>
      ),
      labels: { confirm: "Reversar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => reverse.mutate()
    });

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title="Movimiento de inventario">
      {!m ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={4}>
                {m.number} <Badge color={DIRECTION_COLOR[m.direction]}>{DIRECTION_LABEL[m.direction]}</Badge>{" "}
                {m.status === "reversed" && <Badge color="gray">Reversado</Badge>}
              </Title>
              <Text>{m.conceptName}</Text>
              <Text size="sm" c="dimmed">
                {dayjs(m.movementDate).format("DD/MM/YYYY")} · {m.warehouseCode}
                {m.targetWarehouseCode ? ` → ${m.targetWarehouseCode}` : ""} · {m.createdBy ?? "Sistema"} · contabilizado {fmtDateTime(m.postedAt)}
              </Text>
              {m.reference && <Text size="sm">Ref.: {m.reference}</Text>}
            </div>
            {can("delete") && m.status === "posted" && !m.reversalOfId && m.sourceModule === "INVENTORY" && (
              <Button color="red" variant="light" leftSection={<IconArrowBackUp size={16} />} loading={reverse.isPending} onClick={confirmReverse}>
                Reversar
              </Button>
            )}
          </Group>
          {m.reversalOfNumber && (
            <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />}>
              Reverso de{" "}
              <Button variant="subtle" size="compact-sm" onClick={() => onOpen(m.reversalOfId!)}>
                {m.reversalOfNumber}
              </Button>
            </Alert>
          )}
          {m.reversedByNumber && (
            <Alert variant="light" color="orange" icon={<IconInfoCircle size={18} />}>
              Reversado por{" "}
              <Button variant="subtle" size="compact-sm" onClick={() => onOpen(m.reversedById!)}>
                {m.reversedByNumber}
              </Button>
            </Alert>
          )}
          {m.notes && <Text size="sm">{m.notes}</Text>}

          <Table withTableBorder striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Producto</Table.Th>
                <Table.Th>Lote</Table.Th>
                <Table.Th ta="right">Cantidad</Table.Th>
                <Table.Th ta="right">Costo unit.</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th ta="right">Saldo / prom. después</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {m.lines.map((l) => (
                <Table.Tr key={l.lineNo}>
                  <Table.Td>{l.lineNo}</Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {l.productCode}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {l.productName}
                    </Text>
                  </Table.Td>
                  <Table.Td>{l.lotCode ?? "—"}</Table.Td>
                  <Table.Td ta="right">
                    {fmtMoney(l.quantity, 2)} {l.unitCode}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.unitCost, 4)}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {fmtMoney(l.totalCost)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">
                      {m.warehouseCode}: {fmtMoney(l.balanceAfter, 2)} @ {fmtMoney(l.avgCostAfter, 4)}
                    </Text>
                    {l.targetBalanceAfter !== null && (
                      <Text size="xs">
                        {m.targetWarehouseCode}: {fmtMoney(l.targetBalanceAfter, 2)} @ {fmtMoney(l.targetAvgCostAfter ?? 0, 4)}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="flex-end">
            <Text fw={700}>
              Costo total: <span className="font-mono">{fmtMoney(m.totalCost)}</span>
            </Text>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}

export default function MovementsPage() {
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [range, setRange] = useState<DatesRangeValue>([null, null]);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses") });
  const list = useQuery({
    queryKey: ["inventory", "movements", { debounced, warehouseId, status, range, page }],
    queryFn: () =>
      inventoryApi.listMovements({
        search: debounced,
        warehouseId,
        status,
        from: range[0] ? dayjs(range[0]).format("YYYY-MM-DD") : undefined,
        to: range[1] ? dayjs(range[1]).format("YYYY-MM-DD") : undefined,
        page,
        pageSize: PAGE_SIZE
      }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<Movement, unknown>[]>(
    () => [
      {
        header: "Número",
        cell: ({ row: { original: m } }) => (
          <div>
            <Text size="sm" fw={700} td={m.status === "reversed" ? "line-through" : undefined}>
              {m.number}
            </Text>
            <Text size="xs" c="dimmed">
              {dayjs(m.movementDate).format("DD/MM/YYYY")}
            </Text>
          </div>
        )
      },
      {
        header: "Concepto",
        cell: ({ row: { original: m } }) => (
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" color={DIRECTION_COLOR[m.direction]}>
              {DIRECTION_LABEL[m.direction]}
            </Badge>
            <div>
              <Text size="sm">{m.conceptName}</Text>
              {m.reversalOfNumber && (
                <Text size="xs" c="dimmed">
                  Reverso de {m.reversalOfNumber}
                </Text>
              )}
            </div>
          </Group>
        )
      },
      {
        header: "Almacén",
        cell: ({ row: { original: m } }) => (
          <Text size="sm">
            {m.warehouseCode}
            {m.targetWarehouseCode ? ` → ${m.targetWarehouseCode}` : ""}
          </Text>
        )
      },
      { header: "Líneas", size: 70, cell: ({ row: { original: m } }) => <Text size="sm">{m.lines}</Text> },
      { header: "Costo total", cell: ({ row: { original: m } }) => <Text size="sm" fw={600}>{fmtMoney(m.totalCost)}</Text> },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: m } }) =>
          m.status === "reversed" ? <Badge color="gray">Reversado</Badge> : <Badge color="teal">Contabilizado</Badge>
      },
      { header: "Usuario", cell: ({ row: { original: m } }) => <Text size="xs">{m.createdBy ?? "Sistema"}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Movimientos"
        description="Entradas, salidas y traslados; contabilizados se reversan, no se editan"
        actions={INVENTORY_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              Nuevo movimiento
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Número o referencia" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={220} />
        <Select
          placeholder="Todos los almacenes"
          clearable
          allowDeselect
          data={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
          value={warehouseId}
          onChange={(v) => (setWarehouseId(v), setPage(1))}
          w={240}
        />
        <Select
          placeholder="Todos los estados"
          clearable
          allowDeselect
          data={[
            { value: "posted", label: "Contabilizados" },
            { value: "reversed", label: "Reversados" }
          ]}
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          w={180}
        />
        <DatePickerInput type="range" placeholder="Rango de fechas" clearable valueFormat="DD/MM/YYYY" value={range} onChange={(v) => (setRange(v), setPage(1))} w={250} />
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(m) => m.id}
        onRowClick={(m) => setDetailId(m.id)}
      />
      <NewMovementModal opened={creating} onClose={() => setCreating(false)} onCreated={(m) => setDetailId(m.id)} />
      <MovementDrawer id={detailId} onClose={() => setDetailId(null)} onOpen={setDetailId} />
    </div>
  );
}
