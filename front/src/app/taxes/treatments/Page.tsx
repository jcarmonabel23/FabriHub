/**
 * @project FabriHub - Front
 * @file src/app/taxes/treatments/Page.tsx
 * @description Impuestos → Tratamientos fiscales (TAX_TREATMENTS) con simulador de cálculo
 *
 * El simulador llama al MISMO motor que usarán las órdenes de compra y venta: lo que se ve
 * aquí es exactamente lo que se facturará.
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Divider, Group, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconCalculator, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { ApiError } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney, fmtPct } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { TAX_ACTIONS } from "@/app/settings/settingsActions";
import { taxesApi } from "../services/taxes.service";
import { CALC_METHOD_LABEL, type Simulation, type Treatment } from "../types";

const MODULE = "TAX_TREATMENTS";
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;

function TreatmentModal({ opened, tr, onClose }: Readonly<{ opened: boolean; tr: Treatment | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["taxes", "treatments", "options"], queryFn: taxesApi.treatmentOptions, enabled: opened });
  const empty = { code: "", name: "", description: "", validFrom: dayjs().format("YYYY-MM-DD"), validTo: null as string | null, taxRateId: "", withholdingRateId: null as string | null, calcMethod: "product" };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (opened) {
      setF(
        tr
          ? {
              code: tr.code,
              name: tr.name,
              description: tr.description ?? "",
              validFrom: tr.validFrom,
              validTo: tr.validTo,
              taxRateId: tr.taxRateId,
              withholdingRateId: tr.withholdingRateId,
              calcMethod: tr.calcMethod
            }
          : empty
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, tr]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, description: f.description || null };
      if (tr) {
        const { code: _c, ...rest } = body;
        return taxesApi.updateTreatment(tr.id, rest);
      }
      return taxesApi.createTreatment(body);
    },
    onSuccess: () => {
      notifySuccess(tr ? "Tratamiento actualizado" : "Tratamiento creado");
      qc.invalidateQueries({ queryKey: ["taxes", "treatments"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const datesOk = !f.validTo || f.validTo >= f.validFrom;
  const valid = (Boolean(tr) || CODE_RE.test(f.code)) && f.name.trim().length >= 2 && Boolean(f.taxRateId) && Boolean(f.validFrom) && datesOk;

  return (
    <FormModal opened={opened} onClose={onClose} size="lg" title={tr ? `Editar ${tr.code}` : "Nuevo tratamiento fiscal"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid}>
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(tr)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <Select label="Tarifa de impuesto" required searchable data={options.data?.taxRates ?? []} value={f.taxRateId || null} onChange={(v) => setF({ ...f, taxRateId: v ?? "" })} />
        <Select
          label="Tarifa de retención"
          placeholder="Sin retención"
          clearable
          allowDeselect
          searchable
          data={options.data?.withholdingRates ?? []}
          value={f.withholdingRateId}
          onChange={(v) => setF({ ...f, withholdingRateId: v })}
        />
      </Group>
      <Select
        label="Método de cálculo"
        description="De dónde sale cada parte al facturar"
        data={Object.entries(CALC_METHOD_LABEL).map(([value, label]) => ({ value, label }))}
        value={f.calcMethod}
        onChange={(v) => setF({ ...f, calcMethod: v ?? "product" })}
      />
      <Group grow>
        <DateInput label="Vigente desde" required valueFormat="DD/MM/YYYY" value={f.validFrom} onChange={(v) => setF({ ...f, validFrom: v ?? "" })} />
        <DateInput
          label="Vigente hasta"
          placeholder="Indefinido"
          clearable
          valueFormat="DD/MM/YYYY"
          value={f.validTo}
          minDate={f.validFrom}
          onChange={(v) => setF({ ...f, validTo: v })}
          error={datesOk ? null : "Anterior al inicio"}
        />
      </Group>
      <Textarea label="Descripción" autosize minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
    </FormModal>
  );
}

function Line({ label, value, strong, color }: Readonly<{ label: string; value: string; strong?: boolean; color?: string }>) {
  return (
    <Group justify="space-between">
      <Text size="sm" c={color}>
        {label}
      </Text>
      <Text size={strong ? "lg" : "sm"} fw={strong ? 800 : 600} c={color} ff="monospace">
        {value}
      </Text>
    </Group>
  );
}

function Simulator({ treatments }: Readonly<{ treatments: Treatment[] }>) {
  const [id, setId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | string>(1000);
  const [date, setDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => taxesApi.simulate(id!, Number(amount), date ?? undefined),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "No se pudo calcular");
    }
  });

  useEffect(() => {
    if (id && Number(amount) >= 0 && date) run.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, amount, date]);

  const wh = result?.withholding;

  return (
    <Paper withBorder radius="lg" p="lg" className="bg-white">
      <Group gap="xs" mb="md">
        <IconCalculator size={20} className="text-brand-700" />
        <Title order={5}>Simulador</Title>
      </Group>
      <Stack gap="sm">
        <Select
          label="Tratamiento"
          placeholder="Elija uno"
          searchable
          data={treatments.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))}
          value={id}
          onChange={setId}
        />
        <Group grow>
          <NumberInput label="Monto (base imponible)" min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," value={amount} onChange={setAmount} />
          <DateInput label="Fecha del documento" valueFormat="DD/MM/YYYY" value={date} onChange={setDate} />
        </Group>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        {result && (
          <Stack gap={6} mt="xs" className="rounded-lg bg-gray-50 p-4">
            <Line label="Monto" value={fmtMoney(result.amount)} />
            <Line label={`Impuesto (${fmtPct(result.taxRate)})`} value={fmtMoney(result.tax)} />
            <Line label="Total documento" value={fmtMoney(result.total)} strong />
            {wh && (
              <>
                <Divider my={4} />
                <Line label="Base de la retención" value={fmtMoney(wh.base)} color="dimmed" />
                <Line
                  label={
                    wh.bracket
                      ? `Tramo desde ${fmtMoney(wh.bracket.fromAmount)}: ${fmtPct(wh.bracket.rate)}${wh.bracket.subtrahend ? ` − ${fmtMoney(wh.bracket.subtrahend)}` : ""}`
                      : "Bajo el monto mínimo: no se retiene"
                  }
                  value={`− ${fmtMoney(wh.amount)}`}
                  color="red"
                />
                <Line label="A pagar" value={fmtMoney(result.payable)} strong />
              </>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export default function TreatmentsPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["taxes", "treatments"], queryFn: taxesApi.listTreatments });
  const [modal, setModal] = useState<{ open: boolean; tr: Treatment | null }>({ open: false, tr: null });

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxes", "treatments"] }),
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Treatment, unknown>[]>(
    () => [
      {
        header: "Tratamiento",
        cell: ({ row: { original: t } }) => (
          <div>
            <Text size="sm" fw={700}>
              {t.code} {!t.isCurrent && <Badge size="xs" color="gray">{t.isActive ? "Fuera de vigencia" : "Inactivo"}</Badge>}
            </Text>
            <Text size="xs" c="dimmed">
              {t.name}
            </Text>
          </div>
        )
      },
      {
        header: "Impuesto",
        cell: ({ row: { original: t } }) => (
          <Text size="sm">
            {t.taxLabel} <b>{fmtPct(t.taxRate)}</b>
          </Text>
        )
      },
      { header: "Retención", cell: ({ row: { original: t } }) => <Text size="sm">{t.withholdingLabel ?? "—"}</Text> },
      {
        header: "Vigencia",
        cell: ({ row: { original: t } }) => (
          <Text size="xs">
            {dayjs(t.validFrom).format("DD/MM/YYYY")} → {t.validTo ? dayjs(t.validTo).format("DD/MM/YYYY") : "indefinida"}
          </Text>
        )
      },
      {
        header: "Activo",
        size: 70,
        cell: ({ row: { original: t } }) => (
          <Switch checked={t.isActive} disabled={!can("edit")} onChange={() => mutate.mutate(() => taxesApi.updateTreatment(t.id, { isActive: !t.isActive }))} aria-label="Activo" />
        )
      },
      {
        id: "actions",
        header: "",
        size: 80,
        cell: ({ row: { original: t } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {can("edit") && (
              <Tooltip label="Editar">
                <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setModal({ open: true, tr: t })}>
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {can("delete") && (
              <Tooltip label="Eliminar">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Eliminar"
                  onClick={() => confirmDelete(`el tratamiento ${t.code}`, () => mutate.mutate(() => taxesApi.deleteTreatment(t.id).then(() => notifySuccess("Tratamiento eliminado"))))}
                >
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
        title="Tratamientos fiscales"
        description="Impuesto + retención con vigencia; se asignan a productos, clientes y proveedores"
        actions={TAX_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, tr: null })}>
              Nuevo tratamiento
            </Button>
          )
        }
      />
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(t) => t.id} />
        </div>
        <aside className="w-full xl:w-[380px] shrink-0">
          <Simulator treatments={(list.data ?? []).filter((t) => t.isActive)} />
        </aside>
      </div>
      <TreatmentModal opened={modal.open} tr={modal.tr} onClose={() => setModal({ open: false, tr: null })} />
    </div>
  );
}
