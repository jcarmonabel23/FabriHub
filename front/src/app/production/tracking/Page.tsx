/**
 * @project FabriHub - Front
 * @file src/app/production/tracking/Page.tsx
 * @description Producción → Seguimiento (PRD_TRACKING): iniciar y terminar etapas con horas reales, buena y merma
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Chip, Group, Modal, NumberInput, Select, Stack, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCheck, IconPlayerPlay, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useSearchParams } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { productionApi } from "../services/production.service";
import { ORDER_STATUS_LABEL, PROCESS_STATUS_COLOR, PROCESS_STATUS_LABEL, type TrackingRow } from "../types";

const MODULE = "PRD_TRACKING";
const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);

function FinishModal({ row, onClose }: Readonly<{ row: TrackingRow | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState({ realHours: 0 as number | string, quantityGood: "" as number | string, quantityScrap: 0 as number | string, notes: "" });
  useEffect(() => {
    if (!row) return;
    const elapsed = row.startedAt ? Math.max(0, Math.round(dayjs().diff(dayjs(row.startedAt), "minute") / 6) / 10) : 0;
    setF({ realHours: elapsed || row.stdHours, quantityGood: row.quantityPlanned, quantityScrap: 0, notes: "" });
  }, [row]);
  const save = useMutation({
    mutationFn: () =>
      productionApi.finishProcess(row!.id, {
        realHours: Number(f.realHours),
        quantityGood: f.quantityGood === "" ? null : Number(f.quantityGood),
        quantityScrap: f.quantityScrap === "" ? null : Number(f.quantityScrap),
        notes: f.notes || null
      }),
    onSuccess: (r) => {
      notifySuccess(`${r.orderNumber}: etapa ${r.stageCode} terminada`);
      qc.invalidateQueries({ queryKey: ["production"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <Modal opened={Boolean(row)} onClose={onClose} title={row ? `Terminar ${row.stageCode} · ${row.orderNumber}` : ""}>
      {row && (
        <Stack>
          <Text size="sm" c="dimmed">
            {row.workCenterCode} · teórico {fmtMoney(row.stdHours, 2)} h · inició {fmtDateTime(row.startedAt)}
          </Text>
          <NumberInput label="Horas reales" description="Se multiplican por las tarifas del centro de trabajo" min={0} decimalScale={2} decimalSeparator="," value={f.realHours} onChange={(v) => setF({ ...f, realHours: v })} />
          <Group grow>
            <NumberInput label={`Cantidad buena (${row.unitCode})`} min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.quantityGood} onChange={(v) => setF({ ...f, quantityGood: v })} />
            <NumberInput label="Merma" min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.quantityScrap} onChange={(v) => setF({ ...f, quantityScrap: v })} />
          </Group>
          <Textarea label="Observaciones del operador" autosize minRows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button color="teal" leftSection={<IconCheck size={16} />} loading={save.isPending} disabled={!(Number(f.realHours) >= 0)} onClick={() => save.mutate()}>
              Terminar etapa
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export default function TrackingPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("order") ?? "");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState("open");
  const [workCenterId, setWorkCenterId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<TrackingRow | null>(null);
  const workCenters = useQuery({ queryKey: ["production", "work-centers"], queryFn: () => productionApi.listWorkCenters() });
  const list = useQuery({
    queryKey: ["production", "tracking", { debounced, status, workCenterId }],
    queryFn: () => productionApi.tracking({ search: debounced, status, workCenterId }),
    refetchInterval: 60_000
  });
  const start = useMutation({
    mutationFn: (id: string) => productionApi.startProcess(id),
    onSuccess: (r) => {
      notifySuccess(`${r.orderNumber}: etapa ${r.stageCode} iniciada`);
      qc.invalidateQueries({ queryKey: ["production"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<TrackingRow, unknown>[]>(
    () => [
      {
        header: "Orden",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={700}>{r.orderNumber}</Text>
            <Text size="xs" c="dimmed">{ORDER_STATUS_LABEL[r.orderStatus]} · prioridad {r.priority}</Text>
          </div>
        )
      },
      {
        header: "Producto",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm">{r.productCode}</Text>
            <Text size="xs" c="dimmed">{qty(r.quantityPlanned)} {r.unitCode}</Text>
          </div>
        )
      },
      {
        header: "Etapa",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={600}>{r.sequence} · {r.stageName}</Text>
            <Text size="xs" c="dimmed">{r.workCenterCode} · {r.workCenterName}</Text>
          </div>
        )
      },
      { header: "Estado", cell: ({ row: { original: r } }) => <Badge color={PROCESS_STATUS_COLOR[r.status]} variant="light">{PROCESS_STATUS_LABEL[r.status]}</Badge> },
      {
        header: "Horas",
        cell: ({ row: { original: r } }) => (
          <Text size="sm">
            {r.realHours === null ? "" : <Text span c={r.realHours > r.stdHours ? "red" : "teal"} fw={600}>{fmtMoney(r.realHours, 2)} / </Text>}
            {fmtMoney(r.stdHours, 2)} h
          </Text>
        )
      },
      {
        header: "Registro",
        cell: ({ row: { original: r } }) => (
          <Text size="xs" c="dimmed">
            {r.finishedAt ? `Terminó ${r.finishedBy} ${fmtDateTime(r.finishedAt)}` : r.startedAt ? `Inició ${r.startedBy} ${fmtDateTime(r.startedAt)}` : `Plan ${dayjs(r.plannedStart).format("DD/MM")}`}
          </Text>
        )
      },
      {
        id: "actions",
        header: "",
        cell: ({ row: { original: r } }) =>
          can("edit") && (
            <Group justify="flex-end" wrap="nowrap">
              {r.status === "pending" && (
                <Tooltip label="Termine primero las etapas anteriores" disabled={r.previousPending === 0}>
                  <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} disabled={r.previousPending > 0 || r.orderStatus === "confirmed"} loading={start.isPending && start.variables === r.id} onClick={() => start.mutate(r.id)}>
                    Iniciar
                  </Button>
                </Tooltip>
              )}
              {r.status === "in_process" && (
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} onClick={() => setFinishing(r)}>
                  Terminar
                </Button>
              )}
            </Group>
          )
      }
    ],
    [can, start.isPending, start.variables] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Seguimiento" description="Avance por etapa y tiempos reales de cada orden en planta" actions={PRODUCTION_ACTIONS} />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Orden o producto" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={240} />
        <Select placeholder="Todos los centros de trabajo" clearable data={(workCenters.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} value={workCenterId} onChange={setWorkCenterId} w={280} />
        <Chip.Group multiple={false} value={status} onChange={(v) => setStatus(v as string)}>
          <Group gap={6}>
            <Chip value="open" size="sm" variant="light">Por hacer</Chip>
            <Chip value="in_process" size="sm" variant="light">En curso</Chip>
            <Chip value="pending" size="sm" variant="light">Pendientes</Chip>
            <Chip value="done" size="sm" variant="light">Terminadas</Chip>
          </Group>
        </Chip.Group>
      </Group>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(r) => r.id} emptyText="No hay etapas con este filtro" />
      <FinishModal row={finishing} onClose={() => setFinishing(null)} />
    </div>
  );
}
