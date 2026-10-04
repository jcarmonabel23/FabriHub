/**
 * @project FabriHub - Front
 * @file src/app/purchases/suppliers/Page.tsx
 * @description Compras → Proveedores (PUR_SUPPLIERS): maestro y personas contacto
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Drawer, Group, Loader, Select, SimpleGrid, Stack, Switch, Table, Tabs, TagsInput, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPencil, IconPlus, IconSearch, IconStar, IconTrash } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { settingsApi } from "@/app/settings/services/settings.service";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { PURCHASES_ACTIONS } from "../purchasesActions";
import { purchasesApi } from "../services/purchases.service";
import type { Contact, Supplier } from "../types";

const MODULE = "PUR_SUPPLIERS";
const PAGE_SIZE = 20;
const RIF_RE = /^[VEJPG]-\d{8}-\d$/;

const useOptions = (catalog: string, appliesTo?: "purchases") =>
  useQuery({
    queryKey: ["lookup", catalog, appliesTo],
    queryFn: () => settingsApi.lookup(catalog, appliesTo),
    staleTime: 60_000,
    select: (rows) => rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))
  });

type Form = Record<string, unknown> & { code: string; legalName: string; rif: string; phones: string[] };
const EMPTY: Form = { code: "", legalName: "", tradeName: "", rif: "", phones: [], email: "", address: "", city: "", state: "", country: "Venezuela", notes: "" };
const REFS = ["paymentTermId", "deliveryTermId", "deliveryMethodId", "zoneId", "businessTypeId", "buyerId", "priceListId", "fiscalTreatmentId", "currencyId"];
const TEXTS = ["tradeName", "email", "address", "city", "state", "country", "notes", "payableAccount", "expenseAccount"];

function SupplierModal({ opened, supplier, onClose }: Readonly<{ opened: boolean; supplier: Supplier | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY);
  const opts = {
    paymentTermId: useOptions("payment-terms", "purchases"),
    deliveryTermId: useOptions("delivery-terms", "purchases"),
    deliveryMethodId: useOptions("delivery-methods", "purchases"),
    zoneId: useOptions("zones"),
    businessTypeId: useOptions("business-types", "purchases"),
    buyerId: useOptions("buyers"),
    priceListId: useOptions("purchase-price-lists"),
    fiscalTreatmentId: useOptions("fiscal-treatments"),
    currencyId: useOptions("currencies")
  };

  useEffect(() => {
    if (!opened) return;
    if (!supplier) return setF(EMPTY);
    const base: Form = { ...EMPTY, code: supplier.code, legalName: supplier.legalName, rif: supplier.rif, phones: supplier.phones };
    for (const k of [...REFS, ...TEXTS]) base[k] = (supplier as unknown as Record<string, unknown>)[k] ?? (k in EMPTY ? EMPTY[k] : "");
    setF(base);
  }, [opened, supplier]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { legalName: f.legalName, rif: f.rif, phones: f.phones };
      for (const k of TEXTS) body[k] = (f[k] as string) || null;
      body.country = (f.country as string) || "Venezuela";
      for (const k of REFS) body[k] = f[k] || null;
      return supplier ? purchasesApi.updateSupplier(supplier.id, body) : purchasesApi.createSupplier({ ...body, code: f.code });
    },
    onSuccess: () => {
      notifySuccess(supplier ? "Proveedor actualizado" : "Proveedor creado");
      qc.invalidateQueries({ queryKey: ["purchases", "suppliers"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <TextInput label={label} value={String(f[k] ?? "")} onChange={(e) => set(k, e.currentTarget.value)} {...props} />
  );
  const ref = (k: keyof typeof opts, label: string) => (
    <Select label={label} clearable searchable data={opts[k].data ?? []} value={(f[k] as string) || null} onChange={(v) => set(k, v)} />
  );
  const rifOk = RIF_RE.test(f.rif);
  const valid = (Boolean(supplier) || /^[A-Za-z0-9_-]{1,20}$/.test(f.code)) && f.legalName.trim().length >= 3 && rifOk;

  return (
    <FormModal opened={opened} onClose={onClose} size="xl" title={supplier ? `Editar ${supplier.code}` : "Nuevo proveedor"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid}>
      <Tabs defaultValue="general" keepMounted>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="commercial">Comercial</Tabs.Tab>
          <Tabs.Tab value="fiscal">Fiscal y contable</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Código" required disabled={Boolean(supplier)} value={f.code} onChange={(e) => set("code", e.currentTarget.value.toUpperCase())} />
            <TextInput
              label="RIF"
              required
              placeholder="J-12345678-9"
              value={f.rif}
              onChange={(e) => set("rif", e.currentTarget.value.toUpperCase())}
              error={f.rif && !rifOk ? "Formato: J-12345678-9" : null}
            />
            {text("legalName", "Razón social", { required: true })}
            {text("tradeName", "Nombre comercial")}
            <TagsInput label="Teléfonos" description="Hasta 3; Enter para agregar" maxTags={3} value={f.phones} onChange={(v) => set("phones", v)} />
            {text("email", "Correo")}
            {text("city", "Ciudad")}
            {text("state", "Estado")}
          </SimpleGrid>
          <Stack mt="sm" gap="sm">
            {text("address", "Dirección")}
            <Textarea label="Observaciones" autosize minRows={2} value={String(f.notes ?? "")} onChange={(e) => set("notes", e.currentTarget.value)} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="commercial">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {ref("buyerId", "Comprador asignado")}
            {ref("priceListId", "Lista de precios")}
            {ref("currencyId", "Moneda habitual")}
            {ref("paymentTermId", "Condición de pago")}
            {ref("deliveryTermId", "Condición de entrega")}
            {ref("deliveryMethodId", "Método de entrega")}
            {ref("zoneId", "Zona")}
            {ref("businessTypeId", "Tipo de negocio")}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="fiscal">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {ref("fiscalTreatmentId", "Tratamiento fiscal")}
            <div />
            {text("payableAccount", "Cuenta por pagar")}
            {text("expenseAccount", "Cuenta de gastos")}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">
            El tratamiento del proveedor define sus retenciones (y el impuesto si su método es «por cliente / proveedor»).
          </Text>
        </Tabs.Panel>
      </Tabs>
    </FormModal>
  );
}

function ContactsDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["purchases", "suppliers", id], queryFn: () => purchasesApi.getSupplier(id!), enabled: Boolean(id) });
  const [form, setForm] = useState<{ id?: string; name: string; position: string; phone: string; email: string; isPrimary: boolean } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["purchases", "suppliers"] });

  const save = useMutation({
    mutationFn: () => {
      const b = { name: form!.name, position: form!.position || null, phone: form!.phone || null, email: form!.email || null, isPrimary: form!.isPrimary };
      return form!.id ? purchasesApi.updateContact(form!.id, b) : purchasesApi.addContact(id!, b);
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({ mutationFn: (cid: string) => purchasesApi.deleteContact(cid), onSuccess: refresh, onError: (err) => notifyError(err) });
  const s = detail.data;

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="lg" title="Proveedor">
      {!s ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {s.legalName} {!s.isActive && <Badge color="gray">Inactivo</Badge>}
            </Title>
            <Text size="sm" c="dimmed">
              {s.code} · RIF {s.rif}
              {s.tradeName ? ` · ${s.tradeName}` : ""}
            </Text>
          </div>
          <Table variant="vertical" withTableBorder fz="sm">
            <Table.Tbody>
              {(
                [
                  ["Comprador", s.buyerName],
                  ["Lista de precios", s.priceListCode],
                  ["Moneda", s.currencyCode],
                  ["Condición de pago", s.paymentTermName],
                  ["Tratamiento fiscal", s.fiscalTreatmentCode],
                  ["Zona / tipo", [s.zoneName, s.businessTypeName].filter(Boolean).join(" · ")],
                  ["Teléfonos", s.phones.join(", ")],
                  ["Órdenes abiertas", String(s.openOrders)]
                ] as const
              ).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Th w={170}>{k}</Table.Th>
                  <Table.Td>{v || "—"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="space-between">
            <Title order={6} tt="uppercase" c="petrol.8">
              Personas contacto
            </Title>
            {can("edit") && !form && (
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setForm({ name: "", position: "", phone: "", email: "", isPrimary: false })}>
                Agregar
              </Button>
            )}
          </Group>
          {form && (
            <Stack gap="xs" className="rounded-lg bg-gray-50 p-3">
              <Group grow>
                <TextInput size="xs" label="Nombre" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
                <TextInput size="xs" label="Cargo" value={form.position} onChange={(e) => setForm({ ...form, position: e.currentTarget.value })} />
              </Group>
              <Group grow>
                <TextInput size="xs" label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} />
                <TextInput size="xs" label="Correo" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
              </Group>
              <Group justify="space-between">
                <Switch size="xs" label="Principal" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.currentTarget.checked })} />
                <Group gap="xs">
                  <Button size="xs" variant="default" onClick={() => setForm(null)}>
                    Cancelar
                  </Button>
                  <Button size="xs" loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>
                    Guardar
                  </Button>
                </Group>
              </Group>
            </Stack>
          )}
          {(s.contacts ?? []).map((c: Contact) => (
            <Group key={c.id} justify="space-between" className="rounded-lg border border-gray-100 p-2">
              <div>
                <Text size="sm" fw={600}>
                  {c.name} {c.isPrimary && <IconStar size={12} className="inline text-yellow-500" />}
                </Text>
                <Text size="xs" c="dimmed">
                  {[c.position, c.phone, c.email].filter(Boolean).join(" · ")}
                </Text>
              </div>
              {can("edit") && (
                <Group gap={2}>
                  <ActionIcon variant="subtle" aria-label="Editar contacto" onClick={() => setForm({ id: c.id, name: c.name, position: c.position ?? "", phone: c.phone ?? "", email: c.email ?? "", isPrimary: c.isPrimary })}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label="Eliminar contacto" onClick={() => remove.mutate(c.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}

export default function SuppliersPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; s: Supplier | null }>({ open: false, s: null });
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["purchases", "suppliers", { debounced, page }],
    queryFn: () => purchasesApi.listSuppliers({ search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchases", "suppliers"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Supplier, unknown>[]>(
    () => [
      {
        header: "Proveedor",
        cell: ({ row: { original: s } }) => (
          <div>
            <Text size="sm" fw={700}>
              {s.legalName}
            </Text>
            <Text size="xs" c="dimmed">
              {s.code} · {s.rif}
            </Text>
          </div>
        )
      },
      { header: "Tipo", cell: ({ row: { original: s } }) => <Text size="sm">{s.businessTypeName ?? "—"}</Text> },
      { header: "Comprador", cell: ({ row: { original: s } }) => <Text size="sm">{s.buyerName ?? "—"}</Text> },
      { header: "Pago", cell: ({ row: { original: s } }) => <Text size="sm">{s.paymentTermName ?? "—"}</Text> },
      { header: "Fiscal", cell: ({ row: { original: s } }) => <Text size="sm">{s.fiscalTreatmentCode ?? "—"}</Text> },
      { header: "OC abiertas", size: 90, cell: ({ row: { original: s } }) => <Badge color={s.openOrders ? "blue" : "gray"}>{s.openOrders}</Badge> },
      {
        header: "Activo",
        size: 70,
        cell: ({ row: { original: s } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch checked={s.isActive} disabled={!can("edit")} onChange={() => mutate.mutate(() => purchasesApi.updateSupplier(s.id, { isActive: !s.isActive }))} aria-label="Activo" />
          </div>
        )
      },
      {
        id: "actions",
        header: "",
        size: 80,
        cell: ({ row: { original: s } }) => (
          <Group gap={2} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
            {can("edit") && (
              <Tooltip label="Editar">
                <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setModal({ open: true, s })}>
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {can("delete") && (
              <Tooltip label="Eliminar (solo sin órdenes)">
                <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el proveedor ${s.code}`, () => mutate.mutate(() => purchasesApi.deleteSupplier(s.id).then(() => notifySuccess("Proveedor eliminado"))))}>
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
      <ModuleHeader
        title="Proveedores"
        description="Proveedores de materia prima, empaque y servicios"
        actions={PURCHASES_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, s: null })}>
              Nuevo proveedor
            </Button>
          )
        }
      />
      <Group mb="md">
        <TextInput placeholder="Nombre, código o RIF" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={300} />
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(s) => s.id}
        onRowClick={(s) => setDetailId(s.id)}
      />
      <SupplierModal opened={modal.open} supplier={modal.s} onClose={() => setModal({ open: false, s: null })} />
      <ContactsDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
