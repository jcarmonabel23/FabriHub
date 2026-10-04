/**
 * @project FabriHub - Front
 * @file src/app/sales/customers/Page.tsx
 * @description Ventas → Clientes (SAL_CUSTOMERS): maestro, crédito y personas contacto
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Drawer, Group, Loader, NumberInput, Progress, Select, SimpleGrid, Stack, Switch, Table, Tabs, TagsInput, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
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
import type { Contact } from "@/app/purchases/types";
import { fmtMoney } from "@utils/format";
import { SALES_ACTIONS } from "../salesActions";
import { salesApi } from "../services/sales.service";
import type { Customer } from "../types";

const MODULE = "SAL_CUSTOMERS";
const PAGE_SIZE = 20;
const RIF_RE = /^[VEJPG]-\d{8}-\d$/;

const useOptions = (catalog: string, appliesTo?: "sales") =>
  useQuery({
    queryKey: ["lookup", catalog, appliesTo],
    queryFn: () => settingsApi.lookup(catalog, appliesTo),
    staleTime: 60_000,
    select: (rows) => rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))
  });

type Form = Record<string, unknown> & { code: string; legalName: string; rif: string; phones: string[] };
const EMPTY: Form = {
  code: "",
  legalName: "",
  tradeName: "",
  rif: "",
  phones: [],
  email: "",
  address: "",
  deliveryAddress: "",
  city: "",
  state: "",
  country: "Venezuela",
  notes: "",
  isWithholdingAgent: false,
  creditLimit: ""
};
const REFS = ["paymentTermId", "deliveryTermId", "deliveryMethodId", "zoneId", "businessTypeId", "sellerId", "priceListId", "fiscalTreatmentId", "currencyId"];
const TEXTS = ["tradeName", "email", "address", "deliveryAddress", "city", "state", "country", "notes", "receivableAccount", "incomeAccount"];

function CustomerModal({ opened, customer, onClose }: Readonly<{ opened: boolean; customer: Customer | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY);
  const opts = {
    paymentTermId: useOptions("payment-terms", "sales"),
    deliveryTermId: useOptions("delivery-terms", "sales"),
    deliveryMethodId: useOptions("delivery-methods", "sales"),
    zoneId: useOptions("zones"),
    businessTypeId: useOptions("business-types", "sales"),
    sellerId: useOptions("sellers"),
    priceListId: useOptions("sales-price-lists"),
    fiscalTreatmentId: useOptions("fiscal-treatments"),
    currencyId: useOptions("currencies")
  };

  useEffect(() => {
    if (!opened) return;
    if (!customer) return setF(EMPTY);
    const base: Form = { ...EMPTY, code: customer.code, legalName: customer.legalName, rif: customer.rif, phones: customer.phones };
    for (const k of [...REFS, ...TEXTS]) base[k] = (customer as unknown as Record<string, unknown>)[k] ?? (k in EMPTY ? EMPTY[k] : "");
    base.isWithholdingAgent = customer.isWithholdingAgent;
    base.creditLimit = customer.creditLimit ?? "";
    setF(base);
  }, [opened, customer]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { legalName: f.legalName, rif: f.rif, phones: f.phones };
      for (const k of TEXTS) body[k] = (f[k] as string) || null;
      body.country = (f.country as string) || "Venezuela";
      for (const k of REFS) body[k] = f[k] || null;
      body.isWithholdingAgent = Boolean(f.isWithholdingAgent);
      body.creditLimit = f.creditLimit === "" || f.creditLimit === null ? null : Number(f.creditLimit);
      return customer ? salesApi.updateCustomer(customer.id, body) : salesApi.createCustomer({ ...body, code: f.code });
    },
    onSuccess: () => {
      notifySuccess(customer ? "Cliente actualizado" : "Cliente creado");
      qc.invalidateQueries({ queryKey: ["sales", "customers"] });
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
  const valid = (Boolean(customer) || /^[A-Za-z0-9_-]{1,20}$/.test(f.code)) && f.legalName.trim().length >= 3 && rifOk;

  return (
    <FormModal opened={opened} onClose={onClose} size="xl" title={customer ? `Editar ${customer.code}` : "Nuevo cliente"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid}>
      <Tabs defaultValue="general" keepMounted>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="commercial">Comercial</Tabs.Tab>
          <Tabs.Tab value="fiscal">Fiscal y contable</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Código" required disabled={Boolean(customer)} value={f.code} onChange={(e) => set("code", e.currentTarget.value.toUpperCase())} />
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
            {text("address", "Dirección fiscal")}
            {text("deliveryAddress", "Dirección de despacho")}
            <Textarea label="Observaciones" autosize minRows={2} value={String(f.notes ?? "")} onChange={(e) => set("notes", e.currentTarget.value)} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="commercial">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {ref("sellerId", "Vendedor asignado")}
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
            <NumberInput
              label="Límite de crédito (moneda base)"
              description="Vacío = sin control de crédito"
              min={0}
              decimalScale={2}
              thousandSeparator="."
              decimalSeparator=","
              value={f.creditLimit as number | string}
              onChange={(v) => set("creditLimit", v)}
            />
            <Switch label="Contribuyente especial (nos retiene IVA)" checked={Boolean(f.isWithholdingAgent)} onChange={(e) => set("isWithholdingAgent", e.currentTarget.checked)} mt="xs" />
            <div />
            {text("receivableAccount", "Cuenta por cobrar")}
            {text("incomeAccount", "Cuenta de ingresos")}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="sm">
            Si el cliente es contribuyente especial y su tratamiento lleva retención, la orden descuenta lo que él retendrá del neto a cobrar.
          </Text>
        </Tabs.Panel>
      </Tabs>
    </FormModal>
  );
}

function ContactsDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["sales", "customers", id], queryFn: () => salesApi.getCustomer(id!), enabled: Boolean(id) });
  const [form, setForm] = useState<{ id?: string; name: string; position: string; phone: string; email: string; isPrimary: boolean } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sales", "customers"] });

  const save = useMutation({
    mutationFn: () => {
      const b = { name: form!.name, position: form!.position || null, phone: form!.phone || null, email: form!.email || null, isPrimary: form!.isPrimary };
      return form!.id ? salesApi.updateContact(form!.id, b) : salesApi.addContact(id!, b);
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({ mutationFn: (cid: string) => salesApi.deleteContact(cid), onSuccess: refresh, onError: (err) => notifyError(err) });
  const s = detail.data;

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="lg" title="Cliente">
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
                  ["Vendedor", s.sellerName],
                  ["Lista de precios", s.priceListCode],
                  ["Moneda", s.currencyCode],
                  ["Condición de pago", s.paymentTermName],
                  ["Tratamiento fiscal", [s.fiscalTreatmentCode, s.isWithholdingAgent ? "contribuyente especial" : null].filter(Boolean).join(" · ")],
                  ["Despacho", s.deliveryAddress ?? s.address],
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
          {s.creditLimit !== null && (
            <div>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Crédito usado por órdenes abiertas
                </Text>
                <Text size="xs" fw={600}>
                  {fmtMoney(s.creditUsed)} de {fmtMoney(s.creditLimit)}
                </Text>
              </Group>
              <Progress value={Math.min(100, (s.creditUsed / Math.max(s.creditLimit, 0.01)) * 100)} color={s.creditUsed > s.creditLimit ? "red" : "teal"} />
            </div>
          )}
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

export default function CustomersPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; s: Customer | null }>({ open: false, s: null });
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["sales", "customers", { debounced, page }],
    queryFn: () => salesApi.listCustomers({ search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales", "customers"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      {
        header: "Cliente",
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
      { header: "Vendedor", cell: ({ row: { original: s } }) => <Text size="sm">{s.sellerName ?? "—"}</Text> },
      { header: "Pago", cell: ({ row: { original: s } }) => <Text size="sm">{s.paymentTermName ?? "—"}</Text> },
      {
        header: "Crédito",
        cell: ({ row: { original: s } }) =>
          s.creditLimit === null ? (
            <Text size="xs" c="dimmed">
              Sin límite
            </Text>
          ) : (
            <Text size="sm" c={s.creditUsed > s.creditLimit ? "red" : undefined}>
              {fmtMoney(s.creditUsed)} / {fmtMoney(s.creditLimit)}
            </Text>
          )
      },
      { header: "OV abiertas", size: 90, cell: ({ row: { original: s } }) => <Badge color={s.openOrders ? "blue" : "gray"}>{s.openOrders}</Badge> },
      {
        header: "Activo",
        size: 70,
        cell: ({ row: { original: s } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch checked={s.isActive} disabled={!can("edit")} onChange={() => mutate.mutate(() => salesApi.updateCustomer(s.id, { isActive: !s.isActive }))} aria-label="Activo" />
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
                <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el cliente ${s.code}`, () => mutate.mutate(() => salesApi.deleteCustomer(s.id).then(() => notifySuccess("Cliente eliminado"))))}>
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
        title="Clientes"
        description="Droguerías, farmacias y hospitales: condiciones, crédito y contactos"
        actions={SALES_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, s: null })}>
              Nuevo cliente
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
      <CustomerModal opened={modal.open} customer={modal.s} onClose={() => setModal({ open: false, s: null })} />
      <ContactsDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
