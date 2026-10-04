/**
 * @project FabriHub - Front
 * @file src/app/taxes/taxes/Page.tsx
 * @description Impuestos → Impuestos (TAX_TAXES): cada impuesto con sus tarifas (agregación de la tesis)
 */

import { useEffect, useState } from "react";
import { ActionIcon, Badge, Button, Group, Loader, NumberInput, Paper, Select, Switch, Table, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import FormModal from "@atoms/forms/FormModal";
import { TbEmpty } from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtPct } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { TAX_ACTIONS } from "@/app/settings/settingsActions";
import { taxesApi } from "../services/taxes.service";
import { TAX_KIND_LABEL, type Tax, type TaxRate } from "../types";

const MODULE = "TAX_TAXES";
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;

function TaxModal({ opened, tax, onClose }: Readonly<{ opened: boolean; tax: Tax | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", description: "", kind: "vat" });
  useEffect(() => {
    if (opened) setF({ code: tax?.code ?? "", name: tax?.name ?? "", description: tax?.description ?? "", kind: tax?.kind ?? "vat" });
  }, [opened, tax]);
  const save = useMutation({
    mutationFn: () =>
      tax
        ? taxesApi.updateTax(tax.id, { name: f.name, description: f.description || null, kind: f.kind })
        : taxesApi.createTax({ ...f, description: f.description || null }),
    onSuccess: () => {
      notifySuccess(tax ? "Impuesto actualizado" : "Impuesto creado");
      qc.invalidateQueries({ queryKey: ["taxes", "taxes"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title={tax ? `Editar ${tax.code}` : "Nuevo impuesto"} onSubmit={() => save.mutate()} loading={save.isPending} valid={(Boolean(tax) || CODE_RE.test(f.code)) && f.name.trim().length >= 2}>
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(tax)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <Select label="Naturaleza" data={Object.entries(TAX_KIND_LABEL).map(([value, label]) => ({ value, label }))} value={f.kind} onChange={(v) => setF({ ...f, kind: v ?? "vat" })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <Textarea label="Descripción" autosize minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
    </FormModal>
  );
}

function RateModal({ target, onClose }: Readonly<{ target: { tax: Tax; rate: TaxRate | null } | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", rate: 0 as number | string, account: "" });
  const rate = target?.rate ?? null;
  useEffect(() => {
    if (target) setF({ code: rate?.code ?? "", name: rate?.name ?? "", rate: rate?.rate ?? 0, account: rate?.account ?? "" });
  }, [target, rate]);
  const save = useMutation({
    mutationFn: () =>
      rate
        ? taxesApi.updateTaxRate(rate.id, { name: f.name, rate: Number(f.rate), account: f.account || null })
        : taxesApi.createTaxRate(target!.tax.id, { code: f.code, name: f.name, rate: Number(f.rate), account: f.account || null }),
    onSuccess: () => {
      notifySuccess(rate ? "Tarifa actualizada" : "Tarifa creada");
      qc.invalidateQueries({ queryKey: ["taxes", "taxes"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  const pct = Number(f.rate);
  return (
    <FormModal
      opened={Boolean(target)}
      onClose={onClose}
      title={rate ? `Editar tarifa ${target?.tax.code} · ${rate.code}` : `Nueva tarifa de ${target?.tax.code ?? ""}`}
      onSubmit={() => save.mutate()}
      loading={save.isPending}
      valid={(Boolean(rate) || CODE_RE.test(f.code)) && f.name.trim().length >= 2 && pct >= 0 && pct <= 100}
    >
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(rate)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <NumberInput label="Porcentaje" required min={0} max={100} decimalScale={4} decimalSeparator="," suffix=" %" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <TextInput label="Cuenta contable" description="Tesis: Cuenta Impuestos" value={f.account} onChange={(e) => setF({ ...f, account: e.currentTarget.value })} />
      {rate && rate.treatments > 0 && (
        <Text size="xs" c="orange">
          La usan {rate.treatments} tratamiento(s) fiscal(es): cambiar el porcentaje afecta los cálculos desde ahora (los documentos ya emitidos guardan su monto).
        </Text>
      )}
    </FormModal>
  );
}

export default function TaxesPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const taxes = useQuery({ queryKey: ["taxes", "taxes"], queryFn: taxesApi.listTaxes });
  const [taxModal, setTaxModal] = useState<{ open: boolean; tax: Tax | null }>({ open: false, tax: null });
  const [rateModal, setRateModal] = useState<{ tax: Tax; rate: TaxRate | null } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["taxes", "taxes"] });
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (err) => notifyError(err)
  });

  return (
    <div className="p-6">
      <ModuleHeader
        title="Impuestos"
        description="Impuestos y sus tarifas (alícuotas)"
        actions={TAX_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setTaxModal({ open: true, tax: null })}>
              Nuevo impuesto
            </Button>
          )
        }
      />

      {taxes.isLoading && <Loader size="sm" />}
      {taxes.data?.length === 0 && <TbEmpty text="No hay impuestos definidos" />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(taxes.data ?? []).map((t) => (
          <Paper key={t.id} withBorder radius="lg" p="lg" className={t.isActive ? "" : "opacity-60"}>
            <Group justify="space-between" align="flex-start" mb="sm">
              <div>
                <Group gap="xs">
                  <Title order={4}>{t.code}</Title>
                  <Badge color="petrol">{TAX_KIND_LABEL[t.kind]}</Badge>
                  {!t.isActive && <Badge color="gray">Inactivo</Badge>}
                </Group>
                <Text fw={600}>{t.name}</Text>
                <Text size="sm" c="dimmed">
                  {t.description}
                </Text>
              </div>
              <Group gap={4}>
                {can("edit") && (
                  <>
                    <Switch size="sm" checked={t.isActive} onChange={() => mutate.mutate(() => taxesApi.updateTax(t.id, { isActive: !t.isActive }))} aria-label="Activo" />
                    <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setTaxModal({ open: true, tax: t })}>
                      <IconPencil size={18} />
                    </ActionIcon>
                  </>
                )}
                {can("delete") && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Eliminar"
                    onClick={() => confirmDelete(`el impuesto ${t.code} y sus tarifas`, () => mutate.mutate(() => taxesApi.deleteTax(t.id).then(() => notifySuccess("Impuesto eliminado"))))}
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                )}
              </Group>
            </Group>

            <Table withTableBorder fz="sm" verticalSpacing={6}>
              <Table.Thead className="bg-gray-50">
                <Table.Tr>
                  <Table.Th>Tarifa</Table.Th>
                  <Table.Th ta="right">%</Table.Th>
                  <Table.Th>Cuenta</Table.Th>
                  <Table.Th ta="center">Uso</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {t.rates.map((r) => (
                  <Table.Tr key={r.id} className={r.isActive ? "" : "opacity-50"}>
                    <Table.Td>
                      <b>{r.code}</b> · {r.name}
                    </Table.Td>
                    <Table.Td ta="right" fw={700}>
                      {fmtPct(r.rate)}
                    </Table.Td>
                    <Table.Td>{r.account ?? "—"}</Table.Td>
                    <Table.Td ta="center">
                      <Tooltip label="Tratamientos fiscales que la usan">
                        <Badge size="sm" color={r.treatments ? "petrol" : "gray"}>
                          {r.treatments}
                        </Badge>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        {can("edit") && (
                          <ActionIcon size="sm" variant="subtle" aria-label="Editar tarifa" onClick={() => setRateModal({ tax: t, rate: r })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        )}
                        {can("delete") && (
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            aria-label="Eliminar tarifa"
                            disabled={r.treatments > 0}
                            onClick={() => confirmDelete(`la tarifa ${t.code} · ${r.code}`, () => mutate.mutate(() => taxesApi.deleteTaxRate(r.id)))}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {can("add_new") && (
              <Button variant="subtle" size="xs" mt="xs" leftSection={<IconPlus size={14} />} onClick={() => setRateModal({ tax: t, rate: null })}>
                Agregar tarifa
              </Button>
            )}
          </Paper>
        ))}
      </div>

      <TaxModal opened={taxModal.open} tax={taxModal.tax} onClose={() => setTaxModal({ open: false, tax: null })} />
      <RateModal target={rateModal} onClose={() => setRateModal(null)} />
    </div>
  );
}
