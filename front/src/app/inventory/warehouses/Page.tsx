/**
 * @project FabriHub - Front
 * @file src/app/inventory/warehouses/Page.tsx
 * @description Inventario → Almacenes (INV_WAREHOUSES) con políticas de stock mínimo / máximo
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Drawer, Group, NumberInput, Select, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { IconAdjustmentsHorizontal, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import ProductSelect from "../components/ProductSelect";
import { INVENTORY_ACTIONS } from "../inventoryActions";
import { inventoryApi } from "../services/inventory.service";
import { WAREHOUSE_KIND_LABEL, type ProductOption, type Warehouse } from "../types";

const MODULE = "INV_WAREHOUSES";

function WarehouseModal({ opened, wh, onClose }: Readonly<{ opened: boolean; wh: Warehouse | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", description: "", address: "", kind: "storage" });
  useEffect(() => {
    if (opened) setF({ code: wh?.code ?? "", name: wh?.name ?? "", description: wh?.description ?? "", address: wh?.address ?? "", kind: wh?.kind ?? "storage" });
  }, [opened, wh]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, description: f.description || null, address: f.address || null, kind: f.kind };
      return wh ? inventoryApi.updateWarehouse(wh.id, body) : inventoryApi.createWarehouse({ ...body, code: f.code });
    },
    onSuccess: () => {
      notifySuccess(wh ? "Almacén actualizado" : "Almacén creado");
      qc.invalidateQueries({ queryKey: ["inventory", "warehouses"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title={wh ? `Editar ${wh.code}` : "Nuevo almacén"} onSubmit={() => save.mutate()} loading={save.isPending} valid={(Boolean(wh) || /^[A-Z0-9_-]{1,20}$/.test(f.code)) && f.name.trim().length >= 2}>
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(wh)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <Select label="Uso" data={Object.entries(WAREHOUSE_KIND_LABEL).map(([value, label]) => ({ value, label }))} value={f.kind} onChange={(v) => setF({ ...f, kind: v ?? "storage" })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <TextInput label="Ubicación" value={f.address} onChange={(e) => setF({ ...f, address: e.currentTarget.value })} />
      <Textarea label="Descripción" autosize minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
    </FormModal>
  );
}

function PoliciesDrawer({ wh, onClose }: Readonly<{ wh: Warehouse | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["inventory", "policies", wh?.id], queryFn: () => inventoryApi.listPolicies(wh!.id), enabled: Boolean(wh) });
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [minQty, setMin] = useState<number | string>(0);
  const [maxQty, setMax] = useState<number | string>("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["inventory", "policies", wh?.id] });
    qc.invalidateQueries({ queryKey: ["inventory", "warehouses"] });
  };
  const save = useMutation({
    mutationFn: () => inventoryApi.upsertPolicy(wh!.id, product!.id, { minQty: Number(minQty), maxQty: maxQty === "" ? null : Number(maxQty) }),
    onSuccess: () => {
      notifySuccess("Política guardada");
      setProduct(null);
      setMin(0);
      setMax("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({ mutationFn: (pid: string) => inventoryApi.deletePolicy(wh!.id, pid), onSuccess: refresh, onError: (err) => notifyError(err) });
  const maxOk = maxQty === "" || Number(maxQty) >= Number(minQty);

  return (
    <Drawer opened={Boolean(wh)} onClose={onClose} position="right" size="lg" title={`Stock mínimo y máximo · ${wh?.code ?? ""}`}>
      <Stack>
        <Text size="sm" c="dimmed">
          Por debajo del mínimo o por encima del máximo, el producto aparece en Existencias → Alertas.
        </Text>
        {can("edit") && (
          <Stack gap="xs" className="rounded-lg bg-gray-50 p-3">
            <ProductSelect label="Producto" value={product} onChange={setProduct} stockable />
            <Group grow align="flex-start">
              <NumberInput label="Mínimo" min={0} decimalSeparator="," thousandSeparator="." value={minQty} onChange={setMin} />
              <NumberInput label="Máximo" placeholder="Sin tope" min={0} decimalSeparator="," thousandSeparator="." value={maxQty} onChange={setMax} error={maxOk ? null : "Menor que el mínimo"} />
            </Group>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!product || !maxOk}>
              Guardar política
            </Button>
          </Stack>
        )}
        <Table striped withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Producto</Table.Th>
              <Table.Th ta="right">Existencia</Table.Th>
              <Table.Th ta="right">Mín.</Table.Th>
              <Table.Th ta="right">Máx.</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(list.data ?? []).map((p) => (
              <Table.Tr key={p.productId}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {p.productCode}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {p.productName}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Badge color={p.status === "ok" ? "teal" : "red"} variant="light">
                    {fmtMoney(p.quantity, 2)} {p.unitCode}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{fmtMoney(p.minQty, 2)}</Table.Td>
                <Table.Td ta="right">{p.maxQty === null ? "—" : fmtMoney(p.maxQty, 2)}</Table.Td>
                <Table.Td>
                  {can("edit") && (
                    <ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => remove.mutate(p.productId)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Drawer>
  );
}

export default function WarehousesPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: inventoryApi.listWarehouses });
  const [modal, setModal] = useState<{ open: boolean; wh: Warehouse | null }>({ open: false, wh: null });
  const [policiesFor, setPoliciesFor] = useState<Warehouse | null>(null);

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "warehouses"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Warehouse, unknown>[]>(
    () => [
      {
        header: "Almacén",
        cell: ({ row: { original: w } }) => (
          <div>
            <Text size="sm" fw={700}>
              {w.code} <Badge size="xs" color="gray">{WAREHOUSE_KIND_LABEL[w.kind]}</Badge>
            </Text>
            <Text size="xs" c="dimmed">
              {w.name}
              {w.address ? ` · ${w.address}` : ""}
            </Text>
          </div>
        )
      },
      { header: "Productos con existencia", size: 120, cell: ({ row: { original: w } }) => <Text size="sm">{w.productsWithStock}</Text> },
      { header: "Valor del inventario", cell: ({ row: { original: w } }) => <Text size="sm" fw={600}>{fmtMoney(w.stockValue)}</Text> },
      { header: "Usuarios asignados", size: 110, cell: ({ row: { original: w } }) => <Text size="sm">{w.users}</Text> },
      {
        header: "Activo",
        size: 70,
        cell: ({ row: { original: w } }) => (
          <Switch checked={w.isActive} disabled={!can("edit")} onChange={() => mutate.mutate(() => inventoryApi.updateWarehouse(w.id, { isActive: !w.isActive }))} aria-label="Activo" />
        )
      },
      {
        id: "actions",
        header: "",
        size: 120,
        cell: ({ row: { original: w } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            <Tooltip label="Stock mínimo / máximo">
              <ActionIcon variant="subtle" aria-label="Políticas" onClick={() => setPoliciesFor(w)}>
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
            </Tooltip>
            {can("edit") && (
              <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setModal({ open: true, wh: w })}>
                <IconPencil size={18} />
              </ActionIcon>
            )}
            {can("delete") && (
              <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el almacén ${w.code}`, () => mutate.mutate(() => inventoryApi.deleteWarehouse(w.id)))}>
                <IconTrash size={18} />
              </ActionIcon>
            )}
          </Group>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Almacenes"
        description="Espacios físicos de almacenamiento y sus políticas de stock"
        actions={INVENTORY_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, wh: null })}>
              Nuevo almacén
            </Button>
          )
        }
      />
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(w) => w.id} />
      <WarehouseModal opened={modal.open} wh={modal.wh} onClose={() => setModal({ open: false, wh: null })} />
      <PoliciesDrawer wh={policiesFor} onClose={() => setPoliciesFor(null)} />
    </div>
  );
}
