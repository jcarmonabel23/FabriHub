/**
 * @project FabriHub - Front
 * @file src/app/inventory/products/Page.tsx
 * @description Inventario → Productos (INV_PRODUCTS): maestro, existencia por almacén y relaciones
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Drawer, Group, Loader, Select, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconLink, IconPencil, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { settingsApi } from "@/app/settings/services/settings.service";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import ProductSelect from "../components/ProductSelect";
import { INVENTORY_ACTIONS } from "../inventoryActions";
import { inventoryApi } from "../services/inventory.service";
import { RELATION_LABEL, type ProductOption, type ProductRow } from "../types";
import ProductFormModal from "./ProductFormModal";

const MODULE = "INV_PRODUCTS";
const PAGE_SIZE = 20;

function Flags({ p }: Readonly<{ p: ProductRow }>) {
  return (
    <Group gap={4}>
      {!p.isActive && <Badge size="xs" color="gray">Inactivo</Badge>}
      {p.isOnHold && <Badge size="xs" color="red">Retenido</Badge>}
      {p.isLotControlled && <Badge size="xs" color="petrol">Lote</Badge>}
      {!p.isStockable && <Badge size="xs" color="gray">No inventariable</Badge>}
      {p.isPurchased && <Badge size="xs" variant="outline" color="gray">Compra</Badge>}
      {p.isManufactured && <Badge size="xs" variant="outline" color="gray">Fabrica</Badge>}
      {p.isSold && <Badge size="xs" variant="outline" color="gray">Venta</Badge>}
    </Group>
  );
}

function RelationsModal({ product, onClose }: Readonly<{ product: ProductRow | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["inventory", "products", product?.id], queryFn: () => inventoryApi.getProduct(product!.id), enabled: Boolean(product) });
  const [rows, setRows] = useState<{ related: ProductOption | null; kind: string }[]>([]);
  useEffect(() => {
    if (detail.data) {
      setRows(
        detail.data.relations.map((r) => ({
          kind: r.kind,
          related: { id: r.relatedProductId, code: r.relatedCode, name: r.relatedName } as ProductOption
        }))
      );
    }
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () =>
      inventoryApi.setRelations(
        product!.id,
        rows.filter((r) => r.related).map((r) => ({ relatedProductId: r.related!.id, kind: r.kind }))
      ),
    onSuccess: () => {
      notifySuccess("Relaciones guardadas");
      qc.invalidateQueries({ queryKey: ["inventory", "products"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={Boolean(product)} onClose={onClose} size="lg" title={`Relaciones de ${product?.code ?? ""}`} onSubmit={() => save.mutate()} loading={save.isPending}>
      <Text size="sm" c="dimmed">
        Sustituto: lo reemplaza. Complementario: se ofrece junto en la venta. Equivalente: alternativa ante inexistencia.
      </Text>
      {rows.map((r, i) => (
        <Group key={i} align="flex-end" wrap="nowrap">
          <Select w={170} label={i === 0 ? "Relación" : undefined} data={Object.entries(RELATION_LABEL).map(([value, label]) => ({ value, label }))} value={r.kind} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: v ?? "equivalent" } : x)))} />
          <ProductSelect className="flex-1" label={i === 0 ? "Producto" : undefined} value={r.related} excludeIds={[product?.id ?? ""]} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, related: p } : x)))} />
          <ActionIcon variant="subtle" color="red" mb={4} aria-label="Quitar" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setRows([...rows, { related: null, kind: "equivalent" }])}>
        Agregar relación
      </Button>
    </FormModal>
  );
}

function ProductDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const detail = useQuery({ queryKey: ["inventory", "products", id], queryFn: () => inventoryApi.getProduct(id!), enabled: Boolean(id) });
  const p = detail.data;
  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="lg" title="Producto">
      {!p ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>{p.code}</Title>
            <Text>{p.name}</Text>
            <Text size="sm" c="dimmed">
              {p.typeName}
              {p.familyName ? ` · ${p.familyName}` : ""}
              {p.categoryName ? ` · ${p.categoryName}` : ""}
            </Text>
            <Group mt="xs">
              <Flags p={p} />
            </Group>
          </div>
          <Table variant="vertical" withTableBorder fz="sm">
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={190}>Unidad de almacén</Table.Th>
                <Table.Td>{p.stockUnitCode}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Vida útil</Table.Th>
                <Table.Td>{p.shelfLifeDays ? `${p.shelfLifeDays} días` : "—"}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Tratamiento fiscal</Table.Th>
                <Table.Td>{p.fiscalTreatmentCode ?? "—"}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Precio venta / compra</Table.Th>
                <Table.Td>
                  {p.salePrice === null ? "—" : fmtMoney(p.salePrice)} / {p.purchasePrice === null ? "—" : fmtMoney(p.purchasePrice)}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <div>
            <Title order={6} tt="uppercase" c="petrol.8" mb="xs">
              Existencia por almacén
            </Title>
            {p.stock.length === 0 ? (
              <Text size="sm" c="dimmed">
                Sin existencia en sus almacenes.
              </Text>
            ) : (
              <Table withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Almacén</Table.Th>
                    <Table.Th ta="right">Cantidad</Table.Th>
                    <Table.Th ta="right">Costo prom.</Table.Th>
                    <Table.Th ta="right">Valor</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {p.stock.map((s) => (
                    <Table.Tr key={s.warehouseId}>
                      <Table.Td>{s.warehouseCode}</Table.Td>
                      <Table.Td ta="right">
                        {fmtMoney(s.quantity, p.unitDecimals)} {p.stockUnitCode}
                      </Table.Td>
                      <Table.Td ta="right">{fmtMoney(s.avgCost, 4)}</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {fmtMoney(s.value)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </div>
          {p.relations.length > 0 && (
            <div>
              <Title order={6} tt="uppercase" c="petrol.8" mb="xs">
                Relacionados
              </Title>
              {p.relations.map((r) => (
                <Text key={r.id} size="sm">
                  <Badge size="xs" mr={6}>
                    {RELATION_LABEL[r.kind]}
                  </Badge>
                  {r.relatedCode} · {r.relatedName}
                </Text>
              ))}
            </div>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ open: boolean; product: ProductRow | null }>({ open: false, product: null });
  const [relationsFor, setRelationsFor] = useState<ProductRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const types = useQuery({ queryKey: ["lookup", "product-types"], queryFn: () => settingsApi.lookup("product-types") });
  const list = useQuery({
    queryKey: ["inventory", "products", { debounced, typeId, page }],
    queryFn: () => inventoryApi.listProducts({ search: debounced, typeId, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const remove = useMutation({
    mutationFn: (p: ProductRow) => inventoryApi.deleteProduct(p.id),
    onSuccess: () => {
      notifySuccess("Producto eliminado");
      qc.invalidateQueries({ queryKey: ["inventory", "products"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<ProductRow, unknown>[]>(
    () => [
      {
        header: "Producto",
        cell: ({ row: { original: p } }) => (
          <div>
            <Text size="sm" fw={700}>
              {p.code}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {p.name}
            </Text>
          </div>
        )
      },
      { header: "Tipo", cell: ({ row: { original: p } }) => <Text size="sm">{p.typeName}</Text> },
      { header: "Familia", cell: ({ row: { original: p } }) => <Text size="sm">{p.familyName ?? "—"}</Text> },
      { header: "Características", cell: ({ row: { original: p } }) => <Flags p={p} /> },
      {
        header: "Existencia",
        cell: ({ row: { original: p } }) =>
          p.isStockable ? (
            <Text size="sm" fw={600}>
              {fmtMoney(p.totalQuantity, p.unitDecimals)} {p.stockUnitCode}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )
      },
      {
        id: "actions",
        header: "",
        size: 110,
        cell: ({ row: { original: p } }) => (
          <Group gap={2} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
            {can("edit") && (
              <>
                <Tooltip label="Relaciones">
                  <ActionIcon variant="subtle" aria-label="Relaciones" onClick={() => setRelationsFor(p)}>
                    <IconLink size={18} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Editar">
                  <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setForm({ open: true, product: p })}>
                    <IconPencil size={18} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            {can("delete") && (
              <Tooltip label="Eliminar (solo sin movimientos)">
                <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el producto ${p.code}`, () => remove.mutate(p))}>
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
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
      <ModuleHeader title="Productos" description="Maestro de productos: unidades, control por lote, precios y relaciones" actions={INVENTORY_ACTIONS} />
      <Group justify="space-between" mb="md">
        <Group gap="sm">
          <TextInput placeholder="Código o nombre" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={260} />
          <Select
            placeholder="Todos los tipos"
            clearable
            allowDeselect
            data={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            value={typeId}
            onChange={(v) => (setTypeId(v), setPage(1))}
            w={220}
          />
        </Group>
        {can("add_new") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm({ open: true, product: null })}>
            Nuevo producto
          </Button>
        )}
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(p) => p.id}
        onRowClick={(p) => setDetailId(p.id)}
      />
      <ProductFormModal opened={form.open} product={form.product} onClose={() => setForm({ open: false, product: null })} />
      <RelationsModal product={relationsFor} onClose={() => setRelationsFor(null)} />
      <ProductDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
