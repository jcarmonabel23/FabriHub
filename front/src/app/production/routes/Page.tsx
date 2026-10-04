/**
 * @project FabriHub - Front
 * @file src/app/production/routes/Page.tsx
 * @description Producción → Rutas (PRD_ROUTES): secuencia de etapas con tiempos teóricos por cantidad base
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, NumberInput, Paper, Select, Switch, Table, Text, TextInput, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPencil, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { settingsApi } from "@/app/settings/services/settings.service";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { productionApi } from "../services/production.service";
import type { Route } from "../types";

const MODULE = "PRD_ROUTES";

interface StepForm {
  key: number;
  sequence: number | string;
  stageId: string | null;
  workCenterId: string | null;
  setupHours: number | string;
  runHours: number | string;
}

let seq = 0;
const newStep = (sequence: number): StepForm => ({ key: ++seq, sequence, stageId: null, workCenterId: null, setupHours: 0, runHours: 0 });

function RouteEditor({ target, onClose }: Readonly<{ target: string | "new" | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const editingId = target && target !== "new" ? target : null;
  const detail = useQuery({ queryKey: ["production", "routes", editingId], queryFn: () => productionApi.getRoute(editingId!), enabled: Boolean(editingId) });
  const stages = useQuery({ queryKey: ["lookup", "stages"], queryFn: () => settingsApi.lookup("stages"), enabled: Boolean(target) });
  const centers = useQuery({ queryKey: ["lookup", "production-centers"], queryFn: () => settingsApi.lookup("production-centers"), enabled: Boolean(target) });
  const workCenters = useQuery({ queryKey: ["production", "work-centers"], queryFn: () => productionApi.listWorkCenters(), enabled: Boolean(target) });

  const [f, setF] = useState({ code: "", name: "", description: "", productionCenterId: null as string | null, baseQuantity: 1 as number | string, isActive: true });
  const [steps, setSteps] = useState<StepForm[]>([]);
  useEffect(() => {
    if (target === "new") {
      setF({ code: "", name: "", description: "", productionCenterId: null, baseQuantity: 1, isActive: true });
      setSteps([newStep(10)]);
    }
  }, [target]);
  useEffect(() => {
    const r = detail.data;
    if (!r || !editingId) return;
    setF({ code: r.code, name: r.name, description: r.description ?? "", productionCenterId: r.productionCenterId, baseQuantity: r.baseQuantity, isActive: r.isActive });
    setSteps(r.steps.map((s) => ({ key: ++seq, sequence: s.sequence, stageId: s.stageId, workCenterId: s.workCenterId, setupHours: s.setupHours, runHours: s.runHours })));
  }, [detail.data, editingId]);

  const wcOptions = (workCenters.data ?? [])
    .filter((w) => w.isActive && (!f.productionCenterId || w.productionCenterId === f.productionCenterId))
    .map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const rates = new Map((workCenters.data ?? []).map((w) => [w.id, w]));
  const totalHours = steps.reduce((a, s) => a + Number(s.setupHours || 0) + Number(s.runHours || 0), 0);
  const baseCost = steps.reduce((a, s) => {
    const w = s.workCenterId ? rates.get(s.workCenterId) : undefined;
    return a + (Number(s.setupHours || 0) + Number(s.runHours || 0)) * ((w?.laborRate ?? 0) + (w?.overheadRate ?? 0));
  }, 0);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        description: f.description || null,
        productionCenterId: f.productionCenterId,
        baseQuantity: Number(f.baseQuantity),
        isActive: f.isActive,
        steps: steps.map((s) => ({ sequence: Number(s.sequence), stageId: s.stageId, workCenterId: s.workCenterId, setupHours: Number(s.setupHours || 0), runHours: Number(s.runHours || 0) }))
      };
      return editingId ? productionApi.updateRoute(editingId, body) : productionApi.createRoute({ ...body, code: f.code });
    },
    onSuccess: (r) => {
      notifySuccess(`Ruta ${r.code} guardada`);
      qc.invalidateQueries({ queryKey: ["production"] });
      qc.invalidateQueries({ queryKey: ["lookup", "routes"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  const set = (key: number, patch: Partial<StepForm>) => setSteps((x) => x.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const valid =
    f.name.trim().length >= 2 &&
    (Boolean(editingId) || f.code.trim().length > 0) &&
    Number(f.baseQuantity) > 0 &&
    steps.length > 0 &&
    steps.every((s) => s.stageId && s.workCenterId && Number(s.sequence) > 0);

  return (
    <FormModal opened={Boolean(target)} onClose={onClose} title={editingId ? `Ruta ${f.code}` : "Nueva ruta"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid} size="72rem">
      <Group grow align="flex-start">
        <TextInput label="Código" required disabled={Boolean(editingId)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} maxLength={20} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <Select label="Centro de producción" clearable data={(centers.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} value={f.productionCenterId} onChange={(v) => setF({ ...f, productionCenterId: v })} />
        <NumberInput label="Cantidad base" description="Los tiempos de ejecución son para esta cantidad" min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.baseQuantity} onChange={(v) => setF({ ...f, baseQuantity: v })} />
      </Group>
      <Textarea label="Descripción" autosize minRows={1} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
      <Paper withBorder radius="md" className="overflow-x-auto">
        <Table verticalSpacing={6} miw={820}>
          <Table.Thead className="bg-gray-50">
            <Table.Tr>
              <Table.Th w={90}>Secuencia</Table.Th>
              <Table.Th>Etapa</Table.Th>
              <Table.Th>Centro de trabajo</Table.Th>
              <Table.Th w={120}>Preparación (h)</Table.Th>
              <Table.Th w={120}>Ejecución (h)</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {steps.map((s) => (
              <Table.Tr key={s.key}>
                <Table.Td>
                  <NumberInput size="xs" min={1} max={9999} value={s.sequence} onChange={(v) => set(s.key, { sequence: v })} />
                </Table.Td>
                <Table.Td>
                  <Select size="xs" searchable data={(stages.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} value={s.stageId} onChange={(v) => set(s.key, { stageId: v })} />
                </Table.Td>
                <Table.Td>
                  <Select size="xs" searchable data={wcOptions} value={s.workCenterId} onChange={(v) => set(s.key, { workCenterId: v })} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" min={0} decimalScale={4} decimalSeparator="," value={s.setupHours} onChange={(v) => set(s.key, { setupHours: v })} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" min={0} decimalScale={4} decimalSeparator="," value={s.runHours} onChange={(v) => set(s.key, { runHours: v })} />
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" aria-label="Quitar" disabled={steps.length === 1} onClick={() => setSteps((x) => x.filter((y) => y.key !== s.key))}>
                    <IconX size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Group justify="space-between">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setSteps((x) => [...x, newStep((Math.max(0, ...x.map((y) => Number(y.sequence) || 0)) || 0) + 10)])}>
          Agregar etapa
        </Button>
        <Text size="sm" c="dimmed">
          {fmtMoney(totalHours, 2)} h para {fmtMoney(Number(f.baseQuantity) || 0, 2)} · costo de conversión {fmtMoney(baseCost)}
        </Text>
      </Group>
      <Switch label="Activa" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.currentTarget.checked })} />
    </FormModal>
  );
}

export default function RoutesPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 300);
  const [target, setTarget] = useState<string | "new" | null>(null);
  const list = useQuery({ queryKey: ["production", "routes", { debounced }], queryFn: () => productionApi.listRoutes({ search: debounced }) });
  const remove = useMutation({
    mutationFn: (id: string) => productionApi.deleteRoute(id),
    onSuccess: () => {
      notifySuccess("Ruta eliminada");
      qc.invalidateQueries({ queryKey: ["production", "routes"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Route, unknown>[]>(
    () => [
      {
        header: "Ruta",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={700}>{r.code}</Text>
            <Text size="xs" c="dimmed">{r.name}</Text>
          </div>
        )
      },
      { header: "Centro", cell: ({ row: { original: r } }) => <Text size="sm">{r.productionCenterCode ?? "—"}</Text> },
      { header: "Etapas", cell: ({ row: { original: r } }) => <Text size="sm">{r.steps}</Text> },
      { header: "Horas / cantidad base", cell: ({ row: { original: r } }) => <Text size="sm">{fmtMoney(r.baseHours, 2)} h / {fmtMoney(r.baseQuantity, 2)}</Text> },
      { header: "Fórmulas", cell: ({ row: { original: r } }) => <Text size="sm">{r.formulas}</Text> },
      { header: "Estado", cell: ({ row: { original: r } }) => <Badge color={r.isActive ? "teal" : "gray"} variant="light">{r.isActive ? "Activa" : "Inactiva"}</Badge> },
      {
        id: "actions",
        header: "",
        cell: ({ row: { original: r } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
            {can("edit") && <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setTarget(r.id)}><IconPencil size={16} /></ActionIcon>}
            {can("delete") && <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`la ruta ${r.code}`, () => remove.mutate(r.id))}><IconTrash size={16} /></ActionIcon>}
          </Group>
        )
      }
    ],
    [can] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Rutas"
        description="Etapas, centros de trabajo y tiempos teóricos de fabricación"
        actions={PRODUCTION_ACTIONS}
        right={can("add_new") && <Button leftSection={<IconPlus size={16} />} onClick={() => setTarget("new")}>Nueva ruta</Button>}
      />
      <Group mb="md">
        <TextInput placeholder="Código o nombre" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
      </Group>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(r) => r.id} onRowClick={can("edit") ? (r) => setTarget(r.id) : undefined} />
      <RouteEditor target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
