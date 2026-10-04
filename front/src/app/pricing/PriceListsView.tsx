/**
 * @project FabriHub - Front
 * @file src/app/pricing/PriceListsView.tsx
 * @description Listas de precios por producto y promociones: una sola pantalla para Compras
 *              (PUR_PRICE_LISTS) y Ventas (SAL_PRICE_LISTS), igual que el motor de la API
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Drawer, Group, NumberInput, Select, Stack, Switch, Table, Text, TextInput, Tooltip } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconListDetails, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { settingsApi } from "@/app/settings/services/settings.service";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import type { HeaderAction } from "@atoms/layouts/ModuleHeader";
import type { PriceList } from "@/app/purchases/types";
import { priceListsApi, type PriceScope } from "./priceLists.service";

const fmtD = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "");

interface ScopeProps {
  scope: PriceScope;
  module: string;
}

function ListModal({ scope, opened, list, onClose }: Readonly<Pick<ScopeProps, "scope"> & { opened: boolean; list: PriceList | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const api = priceListsApi(scope);
  const currencies = useQuery({ queryKey: ["lookup", "currencies"], queryFn: () => settingsApi.lookup("currencies") });
  const [f, setF] = useState({ code: "", name: "", currencyId: null as string | null, validFrom: null as string | null, validTo: null as string | null });
  useEffect(() => {
    if (opened) setF({ code: list?.code ?? "", name: list?.name ?? "", currencyId: list?.currencyId ?? null, validFrom: list?.validFrom ?? null, validTo: list?.validTo ?? null });
  }, [opened, list]);
  const save = useMutation({
    mutationFn: () => {
      const b = { name: f.name, currencyId: f.currencyId, validFrom: f.validFrom, validTo: f.validTo };
      return list ? api.update(list.id, b) : api.create({ ...b, code: f.code });
    },
    onSuccess: () => {
      notifySuccess(list ? "Lista actualizada" : "Lista creada");
      qc.invalidateQueries({ queryKey: [scope, "price-lists"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title={list ? `Editar ${list.code}` : "Nueva lista de precios"} onSubmit={() => save.mutate()} loading={save.isPending} valid={(Boolean(list) || /^[A-Za-z0-9_-]{1,20}$/.test(f.code)) && f.name.trim().length >= 2 && Boolean(f.currencyId)}>
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(list)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <Select label="Moneda" required data={(currencies.data ?? []).map((c) => ({ value: c.id, label: c.code }))} value={f.currencyId} onChange={(v) => setF({ ...f, currencyId: v })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <Group grow>
        <DateInput label="Vigente desde" clearable valueFormat="DD/MM/YYYY" value={f.validFrom} onChange={(v) => setF({ ...f, validFrom: v })} />
        <DateInput label="Hasta" clearable valueFormat="DD/MM/YYYY" value={f.validTo} onChange={(v) => setF({ ...f, validTo: v })} />
      </Group>
    </FormModal>
  );
}

function ItemsDrawer({ scope, module, list, onClose }: Readonly<ScopeProps & { list: PriceList | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(module);
  const api = priceListsApi(scope);
  const items = useQuery({ queryKey: [scope, "price-items", list?.id], queryFn: () => api.items(list!.id), enabled: Boolean(list) });
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [price, setPrice] = useState<number | string>("");
  const [promo, setPromo] = useState<number | string>("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: [scope, "price-items", list?.id] });
    qc.invalidateQueries({ queryKey: [scope, "price-lists"] });
  };
  const save = useMutation({
    mutationFn: () => api.upsertItem(list!.id, product!.id, { price: Number(price), promoPrice: promo === "" ? null : Number(promo), promoFrom: from, promoTo: to }),
    onSuccess: () => {
      setProduct(null);
      setPrice("");
      setPromo("");
      setFrom(null);
      setTo(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({ mutationFn: (pid: string) => api.deleteItem(list!.id, pid), onSuccess: refresh, onError: (err) => notifyError(err) });
  const promoOk = promo === "" || (from && to && to >= from);

  return (
    <Drawer opened={Boolean(list)} onClose={onClose} position="right" size="xl" title={`Precios · ${list?.code ?? ""} (${list?.currencyCode ?? ""})`}>
      <Stack>
        {can("edit") && (
          <Stack gap="xs" className="rounded-lg bg-gray-50 p-3">
            <ProductSelect label="Producto" only={scope === "sales" ? "sold" : "purchased"} value={product} onChange={setProduct} />
            <Group grow align="flex-start">
              <NumberInput label={`Precio por ${(scope === "sales" ? product?.saleUnitCode : product?.purchaseUnitCode) ?? product?.unitCode ?? "unidad"}`} min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={price} onChange={setPrice} />
              <NumberInput label="Precio promoción" min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={promo} onChange={setPromo} />
              <DateInput label="Promo desde" clearable valueFormat="DD/MM/YYYY" disabled={promo === ""} value={from} onChange={setFrom} />
              <DateInput label="Promo hasta" clearable valueFormat="DD/MM/YYYY" disabled={promo === ""} value={to} onChange={setTo} error={promoOk ? null : "Fechas inválidas"} />
            </Group>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!product || price === "" || !promoOk}>
              Guardar precio
            </Button>
          </Stack>
        )}
        <Table striped withTableBorder fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Producto</Table.Th>
              <Table.Th ta="right">Precio</Table.Th>
              <Table.Th>Promoción</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(items.data ?? []).map((i) => (
              <Table.Tr key={i.productId}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {i.productCode}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {i.productName}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  {fmtMoney(i.price, 4)} / {i.unitCode}
                </Table.Td>
                <Table.Td>
                  {i.promoPrice !== null ? (
                    <Badge color={i.promoActive ? "teal" : "gray"} variant="light">
                      {fmtMoney(i.promoPrice, 4)} · {fmtD(i.promoFrom)} – {fmtD(i.promoTo)}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Table.Td>
                <Table.Td>
                  {can("edit") && (
                    <ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => remove.mutate(i.productId)}>
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

export default function PriceListsView({
  scope,
  module,
  description,
  partyLabel,
  actions
}: Readonly<ScopeProps & { description: string; partyLabel: string; actions: HeaderAction[] }>) {
  const qc = useQueryClient();
  const can = useCan(module);
  const api = priceListsApi(scope);
  const lists = useQuery({ queryKey: [scope, "price-lists"], queryFn: api.list });
  const [modal, setModal] = useState<{ open: boolean; l: PriceList | null }>({ open: false, l: null });
  const [itemsFor, setItemsFor] = useState<PriceList | null>(null);
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: [scope, "price-lists"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<PriceList, unknown>[]>(
    () => [
      {
        header: "Lista",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm" fw={700}>
              {l.code}
            </Text>
            <Text size="xs" c="dimmed">
              {l.name}
            </Text>
          </div>
        )
      },
      { header: "Moneda", size: 80, cell: ({ row: { original: l } }) => <Badge variant="outline">{l.currencyCode}</Badge> },
      {
        header: "Vigencia",
        cell: ({ row: { original: l } }) => (
          <Text size="sm">{l.validFrom || l.validTo ? `${fmtD(l.validFrom) || "…"} → ${fmtD(l.validTo) || "indefinida"}` : "Siempre"}</Text>
        )
      },
      { header: "Productos", size: 90, cell: ({ row: { original: l } }) => <Text size="sm">{l.items}</Text> },
      { header: partyLabel, size: 100, cell: ({ row: { original: l } }) => <Text size="sm">{l.parties}</Text> },
      {
        header: "Activa",
        size: 70,
        cell: ({ row: { original: l } }) => (
          <Switch checked={l.isActive} disabled={!can("edit")} onChange={() => mutate.mutate(() => api.update(l.id, { isActive: !l.isActive }))} aria-label="Activa" />
        )
      },
      {
        id: "actions",
        header: "",
        size: 110,
        cell: ({ row: { original: l } }) => (
          <Group gap={2} justify="flex-end" wrap="nowrap">
            <Tooltip label="Precios">
              <ActionIcon variant="subtle" aria-label="Precios" onClick={() => setItemsFor(l)}>
                <IconListDetails size={18} />
              </ActionIcon>
            </Tooltip>
            {can("edit") && (
              <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setModal({ open: true, l })}>
                <IconPencil size={18} />
              </ActionIcon>
            )}
            {can("delete") && (
              <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`la lista ${l.code}`, () => mutate.mutate(() => api.remove(l.id)))}>
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
        title="Listas de precios"
        description={description}
        actions={actions}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, l: null })}>
              Nueva lista
            </Button>
          )
        }
      />
      <DataTable data={lists.data ?? []} columns={columns} loading={lists.isLoading} rowKey={(l) => l.id} />
      <ListModal scope={scope} opened={modal.open} list={modal.l} onClose={() => setModal({ open: false, l: null })} />
      <ItemsDrawer scope={scope} module={module} list={itemsFor} onClose={() => setItemsFor(null)} />
    </div>
  );
}
