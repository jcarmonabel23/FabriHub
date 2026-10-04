/**
 * @project FabriHub - Front
 * @file src/app/production/centers/Page.tsx
 * @description Producción → Centros (PRD_CENTERS): centros de producción, centros de trabajo y sus tipos
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, MultiSelect, NumberInput, Select, Switch, Tabs, Text, TextInput, Textarea } from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import type { CatalogUi } from "@/app/settings/commercial/catalogsUi";
import CatalogTab from "@/app/settings/commercial/components/CatalogTab";
import { settingsApi } from "@/app/settings/services/settings.service";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { productionApi } from "../services/production.service";
import type { ProductionCenter, WorkCenter } from "../types";

const MODULE = "PRD_CENTERS";

const WC_TYPES: CatalogUi = {
  key: "work-center-types",
  module: MODULE,
  label: "Tipos de centro de trabajo",
  singular: "tipo",
  feminine: false,
  codeHint: "p. ej. MAQUINA",
  codeMaxLength: 20,
  fields: []
};

const opts = (list?: { id: string; code: string; name: string }[]) => (list ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));

function useSave<T>(fn: (v: T) => Promise<unknown>, msg: string, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      notifySuccess(msg);
      qc.invalidateQueries({ queryKey: ["production"] });
      qc.invalidateQueries({ queryKey: ["lookup"] });
      onDone();
    },
    onError: (err) => notifyError(err)
  });
}

// ------------------------------------------------------------------ Centros de producción

function CenterModal({ target, onClose }: Readonly<{ target: ProductionCenter | "new" | null; onClose: () => void }>) {
  const editing = target && target !== "new" ? target : null;
  const stages = useQuery({ queryKey: ["lookup", "stages"], queryFn: () => settingsApi.lookup("stages"), enabled: Boolean(target) });
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: Boolean(target) });
  const [f, setF] = useState({ code: "", name: "", description: "", materialsWarehouseId: null as string | null, outputWarehouseId: null as string | null, isActive: true, stageIds: [] as string[] });
  useEffect(() => {
    setF({
      code: editing?.code ?? "",
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      materialsWarehouseId: editing?.materialsWarehouseId ?? null,
      outputWarehouseId: editing?.outputWarehouseId ?? null,
      isActive: editing?.isActive ?? true,
      stageIds: editing?.stages.map((s) => s.id) ?? []
    });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(
    () => {
      const body = { name: f.name, description: f.description || null, materialsWarehouseId: f.materialsWarehouseId, outputWarehouseId: f.outputWarehouseId, isActive: f.isActive, stageIds: f.stageIds };
      return editing ? productionApi.updateCenter(editing.id, body) : productionApi.createCenter({ ...body, code: f.code });
    },
    editing ? "Centro actualizado" : "Centro creado",
    onClose
  );
  return (
    <FormModal opened={Boolean(target)} onClose={onClose} title={editing ? `Centro ${editing.code}` : "Nuevo centro de producción"} onSubmit={() => save.mutate(undefined)} loading={save.isPending} valid={f.name.trim().length >= 2 && (Boolean(editing) || f.code.trim().length > 0)} size="lg">
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(editing)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} maxLength={20} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Group>
      <Textarea label="Descripción" autosize minRows={1} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
      <Group grow>
        <Select label="Almacén de materiales" description="Sugerido al crear órdenes" clearable data={opts(warehouses.data)} value={f.materialsWarehouseId} onChange={(v) => setF({ ...f, materialsWarehouseId: v })} />
        <Select label="Almacén de producto terminado" description="Recibe lo fabricado" clearable data={opts(warehouses.data)} value={f.outputWarehouseId} onChange={(v) => setF({ ...f, outputWarehouseId: v })} />
      </Group>
      <MultiSelect label="Etapas que ejecuta" data={opts(stages.data)} value={f.stageIds} onChange={(v) => setF({ ...f, stageIds: v })} searchable />
      <Switch label="Activo" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.currentTarget.checked })} />
    </FormModal>
  );
}

function CentersTab() {
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["production", "centers"], queryFn: productionApi.listCenters });
  const [target, setTarget] = useState<ProductionCenter | "new" | null>(null);
  const remove = useSave((id: string) => productionApi.deleteCenter(id), "Centro eliminado", () => undefined);
  const columns = useMemo<ColumnDef<ProductionCenter, unknown>[]>(
    () => [
      { header: "Código", cell: ({ row: { original: c } }) => <Text size="sm" fw={700}>{c.code}</Text> },
      { header: "Nombre", cell: ({ row: { original: c } }) => <Text size="sm">{c.name}</Text> },
      { header: "Etapas", cell: ({ row: { original: c } }) => <Group gap={4}>{c.stages.map((s) => <Badge key={s.id} size="xs" variant="light">{s.code}</Badge>)}</Group> },
      { header: "Almacenes", cell: ({ row: { original: c } }) => <Text size="xs">{c.materialsWarehouseCode ?? "—"} → {c.outputWarehouseCode ?? "—"}</Text> },
      { header: "C. trabajo", cell: ({ row: { original: c } }) => <Text size="sm">{c.workCenters}</Text> },
      { header: "Estado", cell: ({ row: { original: c } }) => <Badge color={c.isActive ? "teal" : "gray"} variant="light">{c.isActive ? "Activo" : "Inactivo"}</Badge> },
      {
        id: "actions",
        header: "",
        cell: ({ row: { original: c } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {can("edit") && <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setTarget(c)}><IconPencil size={16} /></ActionIcon>}
            {can("delete") && <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el centro ${c.code}`, () => remove.mutate(c.id))}><IconTrash size={16} /></ActionIcon>}
          </Group>
        )
      }
    ],
    [can] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <>
      {can("add_new") && (
        <Group justify="flex-end" mb="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setTarget("new")}>Nuevo centro</Button>
        </Group>
      )}
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(c) => c.id} />
      <CenterModal target={target} onClose={() => setTarget(null)} />
    </>
  );
}

// ------------------------------------------------------------------ Centros de trabajo

function WorkCenterModal({ target, onClose }: Readonly<{ target: WorkCenter | "new" | null; onClose: () => void }>) {
  const editing = target && target !== "new" ? target : null;
  const types = useQuery({ queryKey: ["lookup", "work-center-types"], queryFn: () => settingsApi.lookup("work-center-types"), enabled: Boolean(target) });
  const centers = useQuery({ queryKey: ["lookup", "production-centers"], queryFn: () => settingsApi.lookup("production-centers"), enabled: Boolean(target) });
  const blank = { code: "", name: "", description: "", workCenterTypeId: null as string | null, productionCenterId: null as string | null, capacityHoursDay: 8 as number | string, efficiencyPct: 100 as number | string, laborRate: 0 as number | string, overheadRate: 0 as number | string, isActive: true };
  const [f, setF] = useState(blank);
  useEffect(() => {
    setF(
      editing
        ? { code: editing.code, name: editing.name, description: editing.description ?? "", workCenterTypeId: editing.workCenterTypeId, productionCenterId: editing.productionCenterId, capacityHoursDay: editing.capacityHoursDay, efficiencyPct: editing.efficiencyPct, laborRate: editing.laborRate, overheadRate: editing.overheadRate, isActive: editing.isActive }
        : blank
    );
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(
    () => {
      const body = {
        name: f.name,
        description: f.description || null,
        workCenterTypeId: f.workCenterTypeId,
        productionCenterId: f.productionCenterId,
        capacityHoursDay: Number(f.capacityHoursDay),
        efficiencyPct: Number(f.efficiencyPct),
        laborRate: Number(f.laborRate),
        overheadRate: Number(f.overheadRate),
        isActive: f.isActive
      };
      return editing ? productionApi.updateWorkCenter(editing.id, body) : productionApi.createWorkCenter({ ...body, code: f.code });
    },
    editing ? "Centro de trabajo actualizado" : "Centro de trabajo creado",
    onClose
  );
  const valid = f.name.trim().length >= 2 && Boolean(f.workCenterTypeId) && Boolean(f.productionCenterId) && (Boolean(editing) || f.code.trim().length > 0) && Number(f.capacityHoursDay) > 0 && Number(f.efficiencyPct) > 0;
  return (
    <FormModal opened={Boolean(target)} onClose={onClose} title={editing ? `Centro de trabajo ${editing.code}` : "Nuevo centro de trabajo"} onSubmit={() => save.mutate(undefined)} loading={save.isPending} valid={valid} size="lg">
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(editing)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} maxLength={20} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <Select label="Tipo" required data={opts(types.data)} value={f.workCenterTypeId} onChange={(v) => setF({ ...f, workCenterTypeId: v })} />
        <Select label="Centro de producción" required data={opts(centers.data)} value={f.productionCenterId} onChange={(v) => setF({ ...f, productionCenterId: v })} />
      </Group>
      <Group grow>
        <NumberInput label="Capacidad (h/día)" min={0.5} max={24} decimalScale={2} value={f.capacityHoursDay} onChange={(v) => setF({ ...f, capacityHoursDay: v })} />
        <NumberInput label="Eficiencia (%)" min={1} max={200} decimalScale={2} value={f.efficiencyPct} onChange={(v) => setF({ ...f, efficiencyPct: v })} />
      </Group>
      <Group grow>
        <NumberInput label="Mano de obra por hora" description="Moneda base" min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.laborRate} onChange={(v) => setF({ ...f, laborRate: v })} />
        <NumberInput label="Costo fabril por hora" description="Indirectos: energía, depreciación…" min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.overheadRate} onChange={(v) => setF({ ...f, overheadRate: v })} />
      </Group>
      <Switch label="Activo" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.currentTarget.checked })} />
    </FormModal>
  );
}

function WorkCentersTab() {
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["production", "work-centers"], queryFn: () => productionApi.listWorkCenters() });
  const [target, setTarget] = useState<WorkCenter | "new" | null>(null);
  const remove = useSave((id: string) => productionApi.deleteWorkCenter(id), "Centro de trabajo eliminado", () => undefined);
  const columns = useMemo<ColumnDef<WorkCenter, unknown>[]>(
    () => [
      {
        header: "Centro de trabajo",
        cell: ({ row: { original: w } }) => (
          <div>
            <Text size="sm" fw={700}>{w.code}</Text>
            <Text size="xs" c="dimmed">{w.name}</Text>
          </div>
        )
      },
      { header: "Tipo", cell: ({ row: { original: w } }) => <Badge variant="light" color="gray">{w.typeName}</Badge> },
      { header: "Centro de producción", cell: ({ row: { original: w } }) => <Text size="sm">{w.productionCenterCode}</Text> },
      { header: "Capacidad", cell: ({ row: { original: w } }) => <Text size="sm">{fmtMoney(w.capacityHoursDay, 1)} h/día · {fmtMoney(w.efficiencyPct, 0)}%</Text> },
      { header: "M. de obra/h", cell: ({ row: { original: w } }) => <Text size="sm" ta="right">{fmtMoney(w.laborRate)}</Text> },
      { header: "Fabril/h", cell: ({ row: { original: w } }) => <Text size="sm" ta="right">{fmtMoney(w.overheadRate)}</Text> },
      { header: "Estado", cell: ({ row: { original: w } }) => <Badge color={w.isActive ? "teal" : "gray"} variant="light">{w.isActive ? "Activo" : "Inactivo"}</Badge> },
      {
        id: "actions",
        header: "",
        cell: ({ row: { original: w } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {can("edit") && <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setTarget(w)}><IconPencil size={16} /></ActionIcon>}
            {can("delete") && <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`el centro de trabajo ${w.code}`, () => remove.mutate(w.id))}><IconTrash size={16} /></ActionIcon>}
          </Group>
        )
      }
    ],
    [can] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <>
      {can("add_new") && (
        <Group justify="flex-end" mb="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setTarget("new")}>Nuevo centro de trabajo</Button>
        </Group>
      )}
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(w) => w.id} />
      <WorkCenterModal target={target} onClose={() => setTarget(null)} />
    </>
  );
}

export default function CentersPage() {
  return (
    <div className="p-6">
      <ModuleHeader title="Centros" description="Centros de producción, centros de trabajo y sus tarifas por hora" actions={PRODUCTION_ACTIONS} />
      <Tabs defaultValue="work-centers" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="work-centers">Centros de trabajo</Tabs.Tab>
          <Tabs.Tab value="centers">Centros de producción</Tabs.Tab>
          <Tabs.Tab value="types">Tipos de centro de trabajo</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="work-centers">
          <WorkCentersTab />
        </Tabs.Panel>
        <Tabs.Panel value="centers">
          <CentersTab />
        </Tabs.Panel>
        <Tabs.Panel value="types">
          <CatalogTab ui={WC_TYPES} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
