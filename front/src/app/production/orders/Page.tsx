/**
 * @project FabriHub - Front
 * @file src/app/production/orders/Page.tsx
 * @description Producción → Órdenes de producción (PRD_ORDERS): listado, detalle y ciclo
 *              creada → liberada → en proceso → confirmada → cerrada
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Chip, Drawer, Group, Loader, Modal, NumberInput, Progress, Select, Stack, Table, Tabs, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconArrowBackUp, IconBan, IconCheck, IconInfoCircle, IconLock, IconPackageExport, IconPencil, IconPlayerPlay, IconPlus, IconSearch, IconTimeline, IconTrash } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { useNavigate, useSearchParams } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ApiError } from "@clients/apiClient";
import { useCan, useCanAccess } from "@modules/access-control/useCan";
import { QUALITY_COLOR, QUALITY_LABEL, type QualityStatus } from "@/app/inventory/types";
import { settingsApi } from "@/app/settings/services/settings.service";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { productionApi, type OrderAction } from "../services/production.service";
import {
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  PROCESS_STATUS_COLOR,
  PROCESS_STATUS_LABEL,
  type ProductionOrder,
  type ProductionOrderDetail,
  type Shortage
} from "../types";
import OrderEditor from "./OrderEditor";

const MODULE = "PRD_ORDERS";
const PAGE_SIZE = 20;
const fmtD = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "—");
const qty = (v: number | null | undefined) => fmtMoney(v ?? 0, (v ?? 0) % 1 === 0 ? 0 : 3);

function askReason(title: string, label: string, onConfirm: (reason: string) => void) {
  let reason = "";
  modals.openConfirmModal({
    title,
    children: <Textarea label={label} required autosize minRows={2} autoFocus onChange={(e) => (reason = e.currentTarget.value)} />,
    labels: { confirm: "Confirmar", cancel: "Cancelar" },
    confirmProps: { color: "red" },
    onConfirm: () => (reason.trim().length >= 3 ? onConfirm(reason.trim()) : notifyError(null, "Indique el motivo"))
  });
}

function shortageText(s: Shortage[]) {
  return s.map((x) => `${x.productCode}: faltan ${qty(x.shortfall)}${x.isCritical ? " (crítico)" : ""}`).join(" · ");
}

// ------------------------------------------------------------------ Consumir materiales

function ConsumeModal({ order, onClose, onDone }: Readonly<{ order: ProductionOrderDetail | null; onClose: () => void; onDone: (o: ProductionOrderDetail) => void }>) {
  const [values, setValues] = useState<Record<string, number | string>>({});
  useEffect(() => {
    if (!order) return;
    setValues(Object.fromEntries(order.lines.map((l) => [l.id, l.quantityReserved > 0 ? l.quantityReserved : Math.max(0, Math.round((l.quantityRequired - l.quantityConsumed) * 1e6) / 1e6)])));
  }, [order]);
  const chosen = order?.lines.filter((l) => Number(values[l.id]) > 0) ?? [];
  const save = useMutation({
    mutationFn: () => productionApi.act(order!.id, "consume", { lines: chosen.map((l) => ({ lineId: l.id, quantity: Number(values[l.id]) })) }),
    onSuccess: (o) => {
      notifySuccess(`Materiales consumidos en ${o.number}`);
      onDone(o);
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <Modal opened={Boolean(order)} onClose={onClose} title={`Consumir materiales · ${order?.number ?? ""}`} size="64rem">
      {order && (
        <Stack>
          <Alert variant="light" color="petrol" icon={<IconInfoCircle size={18} />}>
            Sale primero lo reservado (FEFO) y, si se pide más, lo libre del mismo almacén. El costo es el promedio ponderado del inventario.
          </Alert>
          <Table withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Material</Table.Th>
                <Table.Th>Almacén</Table.Th>
                <Table.Th ta="right">Requerido</Table.Th>
                <Table.Th ta="right">Consumido</Table.Th>
                <Table.Th ta="right">Reservado</Table.Th>
                <Table.Th w={160}>Consumir ahora</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {order.lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{l.productCode}</Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>{l.productName}</Text>
                  </Table.Td>
                  <Table.Td>{l.warehouseCode}</Table.Td>
                  <Table.Td ta="right">{qty(l.quantityRequired)} {l.unitCode}</Table.Td>
                  <Table.Td ta="right">{qty(l.quantityConsumed)}</Table.Td>
                  <Table.Td ta="right">{qty(l.quantityReserved)}</Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" min={0} decimalScale={6} thousandSeparator="." decimalSeparator="," value={values[l.id] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [l.id]: v }))} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button leftSection={<IconPackageExport size={16} />} loading={save.isPending} disabled={chosen.length === 0} onClick={() => save.mutate()}>
              Registrar consumo ({chosen.length})
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Confirmar lo fabricado

function ConfirmModal({ order, onClose, onDone }: Readonly<{ order: ProductionOrderDetail | null; onClose: () => void; onDone: (o: ProductionOrderDetail) => void }>) {
  const [f, setF] = useState({ quantity: "" as number | string, lotCode: "", manufacturedOn: dayjs().format("YYYY-MM-DD") as string | null, expiresOn: null as string | null, notes: "" });
  useEffect(() => {
    if (!order) return;
    const good = order.processes.at(-1)?.quantityGood;
    setF({ quantity: good ?? order.quantityPlanned, lotCode: order.lotCode ?? "", manufacturedOn: dayjs().format("YYYY-MM-DD"), expiresOn: null, notes: "" });
  }, [order]);
  const save = useMutation({
    mutationFn: () =>
      productionApi.act(order!.id, "confirm", { quantity: Number(f.quantity), lotCode: f.lotCode.trim() || null, manufacturedOn: f.manufacturedOn ?? undefined, expiresOn: f.expiresOn, notes: f.notes || null }),
    onSuccess: (o) => {
      notifySuccess(`${o.number}: ${qty(o.quantityProduced)} ${o.unitCode} en el lote ${o.outputLotCode ?? "—"}`);
      onDone(o);
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  const material = order?.lines.reduce((a, l) => a + l.consumedCost, 0) ?? 0;
  const conversion = order?.processes.reduce((a, p) => a + (p.realHours ?? 0) * (p.laborRate + p.overheadRate), 0) ?? 0;
  return (
    <Modal opened={Boolean(order)} onClose={onClose} title={`Confirmar producción · ${order?.number ?? ""}`} size="lg">
      {order && (
        <Stack>
          <Group grow>
            <NumberInput label={`Cantidad fabricada (${order.unitCode})`} required min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} />
            <TextInput label="Lote" required={order.isLotControlled} disabled={!order.isLotControlled} value={f.lotCode} onChange={(e) => setF({ ...f, lotCode: e.currentTarget.value })} maxLength={40} />
          </Group>
          {order.isLotControlled && (
            <Group grow>
              <DateInput label="Fabricado el" valueFormat="DD/MM/YYYY" maxDate={dayjs().format("YYYY-MM-DD")} value={f.manufacturedOn} onChange={(v) => setF({ ...f, manufacturedOn: v })} />
              <DateInput label="Vence" clearable valueFormat="DD/MM/YYYY" placeholder={order.shelfLifeDays ? `+${order.shelfLifeDays} días` : "—"} value={f.expiresOn} onChange={(v) => setF({ ...f, expiresOn: v })} />
            </Group>
          )}
          <Textarea label="Observaciones" autosize minRows={1} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
          <Stack gap={2} className="rounded-lg bg-gray-50 p-3">
            <Group justify="space-between"><Text size="sm">Materiales consumidos</Text><Text size="sm">{fmtMoney(material)}</Text></Group>
            <Group justify="space-between"><Text size="sm">Mano de obra + costo fabril (horas reales)</Text><Text size="sm">{fmtMoney(conversion)}</Text></Group>
            <Group justify="space-between">
              <Text fw={700}>Costo unitario de entrada</Text>
              <Text fw={800} ff="monospace">{Number(f.quantity) > 0 ? fmtMoney((material + conversion) / Number(f.quantity), 4) : "—"}</Text>
            </Group>
          </Stack>
          <Alert variant="light" color="petrol" icon={<IconInfoCircle size={18} />}>
            El lote entra en <b>cuarentena</b> en {order.outputWarehouseCode}. Usted no podrá liberarlo en Calidad (segregación de funciones).
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button color="teal" leftSection={<IconCheck size={16} />} loading={save.isPending} disabled={!(Number(f.quantity) > 0) || (order.isLotControlled && !f.lotCode.trim())} onClick={() => save.mutate()}>
              Confirmar
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Detalle

function CostRow({ label, std, real, bold }: Readonly<{ label: string; std: number; real: number | null; bold?: boolean }>) {
  const diff = real === null ? null : real - std;
  return (
    <Table.Tr>
      <Table.Td fw={bold ? 700 : undefined}>{label}</Table.Td>
      <Table.Td ta="right" fw={bold ? 700 : undefined}>{fmtMoney(std)}</Table.Td>
      <Table.Td ta="right" fw={bold ? 700 : undefined}>{real === null ? "—" : fmtMoney(real)}</Table.Td>
      <Table.Td ta="right">
        {diff === null ? "—" : <Text size="sm" fw={bold ? 700 : undefined} c={diff > 0.005 ? "red" : diff < -0.005 ? "teal" : undefined}>{diff > 0 ? "+" : ""}{fmtMoney(diff)}</Text>}
      </Table.Td>
    </Table.Tr>
  );
}

function OrderDrawer({ id, onClose, onEdit }: Readonly<{ id: string | null; onClose: () => void; onEdit: (o: ProductionOrderDetail) => void }>) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const can = useCan(MODULE);
  const canAccess = useCanAccess();
  const detail = useQuery({ queryKey: ["production", "orders", id], queryFn: () => productionApi.getOrder(id!), enabled: Boolean(id) });
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: Boolean(id) });
  const [consume, setConsume] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [shortages, setShortages] = useState<Shortage[] | null>(null);
  useEffect(() => setShortages(null), [id]);
  const o = detail.data;

  const refresh = (data: ProductionOrderDetail) => {
    qc.setQueryData(["production", "orders", id], data);
    qc.invalidateQueries({ queryKey: ["production", "orders"] });
    qc.invalidateQueries({ queryKey: ["production", "tracking"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  };
  const act = useMutation({
    mutationFn: ({ action, body }: { action: OrderAction; body?: Record<string, unknown> }) => productionApi.act(id!, action, body),
    onSuccess: (data) => {
      notifySuccess(`Orden ${data.number}: ${ORDER_STATUS_LABEL[data.status].toLowerCase()}`);
      setShortages(data.shortages?.length ? data.shortages : null);
      refresh(data);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CRITICAL_SHORTAGE" && Array.isArray(err.details)) setShortages(err.details as Shortage[]);
      notifyError(err);
    }
  });
  const remove = useMutation({
    mutationFn: () => productionApi.deleteOrder(id!),
    onSuccess: () => {
      notifySuccess("Orden eliminada");
      qc.invalidateQueries({ queryKey: ["production", "orders"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  const lineWh = useMutation({
    mutationFn: ({ lineId, warehouseId }: { lineId: string; warehouseId: string }) => productionApi.setLineWarehouse(id!, lineId, warehouseId),
    onSuccess: refresh,
    onError: (err) => notifyError(err)
  });

  if (!id) return null;
  const st = o?.status;
  const processesPending = o ? o.processesTotal - o.processesDone : 0;

  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title="Orden de producción">
      {!o ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {o.number} <Badge color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge> {o.isLate && <Badge color="red" variant="light">Atrasada</Badge>}
            </Title>
            <Text fw={600}>
              {o.productCode} · {o.productName}
            </Text>
            <Text size="sm" c="dimmed">
              {qty(o.quantityPlanned)} {o.unitCode} · fórmula {o.formulaCode} v{o.formulaVersion} · ruta {o.routeCode ?? "—"} · {o.productionCenterName ?? "sin centro"}
            </Text>
            <Text size="sm" c="dimmed">
              Plan {fmtD(o.plannedStart)} → {fmtD(o.plannedEnd)} · prioridad {o.priority} · terminado a {o.outputWarehouseCode}
              {o.lotCode ? ` · lote ${o.lotCode}` : ""}
            </Text>
            <Text size="xs" c="dimmed">
              Creada por {o.createdBy ?? "—"} {fmtDateTime(o.createdAt)}
              {o.releasedAt ? ` · liberada por ${o.releasedBy} ${fmtDateTime(o.releasedAt)}` : ""}
              {o.confirmedAt ? ` · confirmada por ${o.confirmedBy} ${fmtDateTime(o.confirmedAt)}` : ""}
              {o.closedAt ? ` · cerrada por ${o.closedBy} ${fmtDateTime(o.closedAt)}` : ""}
            </Text>
          </div>

          <Group gap="xs">
            {st === "created" && can("edit") && (
              <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => onEdit(o)}>Editar</Button>
            )}
            {st === "created" && can("release") && (
              <Button size="xs" leftSection={<IconPlayerPlay size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "release" })}>Liberar y reservar</Button>
            )}
            {st === "released" && can("release") && (
              <Button size="xs" variant="light" leftSection={<IconArrowBackUp size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "unrelease" })}>Devolver a creada</Button>
            )}
            {(st === "released" || st === "in_process") && can("edit") && (
              <Button size="xs" leftSection={<IconPackageExport size={14} />} onClick={() => setConsume(true)}>Consumir materiales</Button>
            )}
            {(st === "released" || st === "in_process") && canAccess("PRD_TRACKING") && (
              <Button size="xs" variant="light" leftSection={<IconTimeline size={14} />} onClick={() => navigate(`/production/tracking?order=${o.number}`)}>Seguimiento</Button>
            )}
            {st === "in_process" && can("edit") && (
              <Tooltip label={`Faltan ${processesPending} etapa(s) por terminar`} disabled={processesPending === 0}>
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} disabled={processesPending > 0} onClick={() => setConfirm(true)}>Confirmar producción</Button>
              </Tooltip>
            )}
            {st === "confirmed" && can("close") && (
              <Button size="xs" color="dark" leftSection={<IconLock size={14} />} loading={act.isPending} onClick={() => act.mutate({ action: "close" })}>Cerrar y costear</Button>
            )}
            {st === "created" && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => modals.openConfirmModal({ title: "Eliminar orden", children: <Text size="sm">¿Eliminar la orden {o.number}?</Text>, labels: { confirm: "Eliminar", cancel: "Cancelar" }, confirmProps: { color: "red" }, onConfirm: () => remove.mutate() })}>
                Eliminar
              </Button>
            )}
            {(st === "created" || st === "released") && can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={14} />} onClick={() => askReason("Anular orden", "Motivo de la anulación", (reason) => act.mutate({ action: "cancel", body: { reason } }))}>Anular</Button>
            )}
          </Group>

          {shortages && (
            <Alert color={shortages.some((s) => s.isCritical) && st === "created" ? "red" : "yellow"} variant="light" title={st === "created" ? "No se pudo liberar" : "Liberada con faltantes"}>
              {shortageText(shortages)}
            </Alert>
          )}
          {o.cancelReason && <Alert variant="light" color="red">Anulada: {o.cancelReason}</Alert>}
          {o.outputLotCode && (
            <Alert variant="light" color={QUALITY_COLOR[o.outputLotStatus as QualityStatus]} icon={<IconInfoCircle size={18} />}>
              Lote {o.outputLotCode}: {QUALITY_LABEL[o.outputLotStatus as QualityStatus]?.toLowerCase()} · {qty(o.quantityProduced)} {o.unitCode} · entrada {o.outputMovementNumber}
              {o.outputLotStatus === "quarantine" && canAccess("QC_LOTS") && (
                <Button size="compact-xs" variant="subtle" ml="xs" onClick={() => navigate("/quality/lots")}>Ir a Calidad</Button>
              )}
            </Alert>
          )}
          {o.processesTotal > 0 && st !== "created" && st !== "cancelled" && (
            <div>
              <Text size="xs" c="dimmed">Etapas terminadas {o.processesDone} de {o.processesTotal}</Text>
              <Progress value={(o.processesDone / o.processesTotal) * 100} color={o.processesDone === o.processesTotal ? "teal" : "orange"} />
            </div>
          )}

          <Tabs defaultValue="materials" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="materials">Materiales</Tabs.Tab>
              <Tabs.Tab value="processes">Etapas</Tabs.Tab>
              <Tabs.Tab value="costs">Costos</Tabs.Tab>
              <Tabs.Tab value="movements">Movimientos ({o.movements.length})</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="materials" pt="sm">
              <Table withTableBorder striped fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Material</Table.Th>
                    <Table.Th>Almacén</Table.Th>
                    <Table.Th ta="right">Requerido</Table.Th>
                    <Table.Th ta="right">Reservado</Table.Th>
                    <Table.Th ta="right">Consumido</Table.Th>
                    <Table.Th ta="right">Disponible</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {o.lines.map((l) => {
                    const short = st === "created" && l.available < l.quantityRequired - l.quantityConsumed;
                    return (
                      <Table.Tr key={l.id}>
                        <Table.Td>
                          <Group gap={6}>
                            <Text size="sm" fw={600}>{l.productCode}</Text>
                            {l.isCritical && <Badge size="xs" color="red" variant="light">Crítico</Badge>}
                          </Group>
                          <Text size="xs" c="dimmed" lineClamp={1}>{l.productName}</Text>
                          {l.reservations.length > 0 && (
                            <Text size="xs" c="violet">
                              {l.reservations.map((r) => `${r.lotCode ?? "sin lote"}: ${qty(r.quantity)}`).join(" · ")}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {st === "created" && can("edit") ? (
                            <Select size="xs" w={110} data={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.code }))} value={l.warehouseId} onChange={(v) => v && lineWh.mutate({ lineId: l.id, warehouseId: v })} allowDeselect={false} />
                          ) : (
                            l.warehouseCode
                          )}
                        </Table.Td>
                        <Table.Td ta="right">{qty(l.quantityRequired)} {l.unitCode}</Table.Td>
                        <Table.Td ta="right">{qty(l.quantityReserved)}</Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" c={l.quantityConsumed >= l.quantityRequired - 1e-9 ? "teal" : undefined}>{qty(l.quantityConsumed)}</Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" c={short ? (l.isCritical ? "red" : "orange") : undefined} fw={short ? 700 : undefined}>{qty(l.available)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Tabs.Panel>

            <Tabs.Panel value="processes" pt="sm">
              {o.processes.length === 0 ? (
                <Text size="sm" c="dimmed">La fórmula no tiene ruta: no hay etapas que seguir.</Text>
              ) : (
                <Table withTableBorder striped fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Etapa</Table.Th>
                      <Table.Th>Centro de trabajo</Table.Th>
                      <Table.Th>Estado</Table.Th>
                      <Table.Th ta="right">Horas est.</Table.Th>
                      <Table.Th ta="right">Horas reales</Table.Th>
                      <Table.Th ta="right">Buena / merma</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {o.processes.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td>
                          <Text size="sm" fw={600}>{p.sequence} · {p.stageCode}</Text>
                          <Text size="xs" c="dimmed">{p.finishedAt ? `${p.finishedBy} · ${fmtDateTime(p.finishedAt)}` : p.startedAt ? `Inició ${p.startedBy} · ${fmtDateTime(p.startedAt)}` : p.stageName}</Text>
                        </Table.Td>
                        <Table.Td>{p.workCenterCode}</Table.Td>
                        <Table.Td><Badge size="sm" color={PROCESS_STATUS_COLOR[p.status]} variant="light">{PROCESS_STATUS_LABEL[p.status]}</Badge></Table.Td>
                        <Table.Td ta="right">{fmtMoney(p.stdHours, 2)}</Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" c={p.realHours !== null && p.realHours > p.stdHours ? "red" : undefined}>{p.realHours === null ? "—" : fmtMoney(p.realHours, 2)}</Text>
                        </Table.Td>
                        <Table.Td ta="right">{p.quantityGood === null ? "—" : `${qty(p.quantityGood)} / ${qty(p.quantityScrap)}`}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="costs" pt="sm">
              <Table withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Concepto</Table.Th>
                    <Table.Th ta="right">Estándar ({qty(o.quantityPlanned)})</Table.Th>
                    <Table.Th ta="right">Real ({qty(o.quantityProduced)})</Table.Th>
                    <Table.Th ta="right">Diferencia</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <CostRow label="Materiales" std={o.stdMaterialCost} real={o.realMaterialCost ?? (o.lines.some((l) => l.consumedCost > 0) ? o.lines.reduce((a, l) => a + l.consumedCost, 0) : null)} />
                  <CostRow label="Mano de obra" std={o.stdLaborCost} real={o.realLaborCost} />
                  <CostRow label="Costo fabril" std={o.stdOverheadCost} real={o.realOverheadCost} />
                  <CostRow
                    label="Total"
                    bold
                    std={o.stdMaterialCost + o.stdLaborCost + o.stdOverheadCost}
                    real={o.realMaterialCost === null ? null : (o.realMaterialCost ?? 0) + (o.realLaborCost ?? 0) + (o.realOverheadCost ?? 0)}
                  />
                </Table.Tbody>
              </Table>
              <Stack gap={2} mt="sm" className="rounded-lg bg-gray-50 p-3">
                <Group justify="space-between">
                  <Text size="sm">Costo estándar por {o.unitCode}</Text>
                  <Text size="sm">{fmtMoney((o.stdMaterialCost + o.stdLaborCost + o.stdOverheadCost) / o.quantityPlanned, 4)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">Costo real por {o.unitCode}</Text>
                  <Text size="sm">{o.realUnitCost === null ? "—" : fmtMoney(o.realUnitCost, 4)}</Text>
                </Group>
                {o.variance !== null && (
                  <Group justify="space-between">
                    <Text fw={700}>Variación (real − estándar de lo fabricado)</Text>
                    <Text fw={800} c={o.variance > 0 ? "red" : "teal"}>{o.variance > 0 ? "+" : ""}{fmtMoney(o.variance)} {o.variance > 0 ? "desfavorable" : "favorable"}</Text>
                  </Group>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="movements" pt="sm">
              {o.movements.length === 0 ? (
                <Text size="sm" c="dimmed">Sin movimientos de inventario todavía.</Text>
              ) : (
                <Table withTableBorder striped fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Movimiento</Table.Th>
                      <Table.Th>Concepto</Table.Th>
                      <Table.Th>Almacén</Table.Th>
                      <Table.Th ta="right">Costo</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {o.movements.map((m) => (
                      <Table.Tr key={m.id}>
                        <Table.Td>
                          <Text size="sm" fw={600}>{m.number}</Text>
                          <Text size="xs" c="dimmed">{fmtD(m.movementDate)} · {m.lines} línea(s)</Text>
                        </Table.Td>
                        <Table.Td><Badge size="sm" variant="light" color={m.direction === "in" ? "teal" : "orange"}>{m.conceptName}</Badge></Table.Td>
                        <Table.Td>{m.warehouseCode}</Table.Td>
                        <Table.Td ta="right">{fmtMoney(m.totalCost)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>
          </Tabs>
          {o.notes && <Text size="sm" style={{ whiteSpace: "pre-line" }}>{o.notes}</Text>}
        </Stack>
      )}
      <ConsumeModal order={consume ? (o ?? null) : null} onClose={() => setConsume(false)} onDone={refresh} />
      <ConfirmModal order={confirm ? (o ?? null) : null} onClose={() => setConfirm(false)} onDone={refresh} />
    </Drawer>
  );
}

const FILTERS: { value: string; label: string }[] = [
  { value: "open", label: "Abiertas" },
  { value: "created", label: "Creadas" },
  { value: "released", label: "Liberadas" },
  { value: "in_process", label: "En proceso" },
  { value: "confirmed", label: "Por cerrar" },
  { value: "closed", label: "Cerradas" },
  { value: "cancelled", label: "Anuladas" },
  { value: "", label: "Todas" }
];

export default function ProductionOrdersPage() {
  const can = useCan(MODULE);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [debounced] = useDebouncedValue(search, 350);
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; order: ProductionOrderDetail | null }>({ open: false, order: null });

  const list = useQuery({
    queryKey: ["production", "orders", { debounced, status, page }],
    queryFn: () => productionApi.listOrders({ search: debounced, status: status || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<ProductionOrder, unknown>[]>(
    () => [
      {
        header: "Orden",
        cell: ({ row: { original: o } }) => (
          <div>
            <Text size="sm" fw={700}>{o.number}</Text>
            <Text size="xs" c="dimmed">Prioridad {o.priority}</Text>
          </div>
        )
      },
      {
        header: "Producto",
        cell: ({ row: { original: o } }) => (
          <div>
            <Text size="sm">{o.productCode}</Text>
            <Text size="xs" c="dimmed" lineClamp={1}>{o.productName}</Text>
          </div>
        )
      },
      {
        header: "Cantidad",
        cell: ({ row: { original: o } }) => (
          <Text size="sm" ta="right">
            {o.quantityProduced > 0 ? `${qty(o.quantityProduced)} / ` : ""}
            {qty(o.quantityPlanned)} {o.unitCode}
          </Text>
        )
      },
      {
        header: "Estado",
        cell: ({ row: { original: o } }) => (
          <Group gap={4}>
            <Badge color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            {o.isLate && <Badge color="red" variant="light">Atrasada</Badge>}
          </Group>
        )
      },
      {
        header: "Etapas",
        cell: ({ row: { original: o } }) =>
          o.processesTotal > 0 ? <Progress w={90} value={(o.processesDone / o.processesTotal) * 100} color={o.processesDone === o.processesTotal ? "teal" : "orange"} /> : <Text size="xs" c="dimmed">—</Text>
      },
      { header: "Plan", cell: ({ row: { original: o } }) => <Text size="sm">{fmtD(o.plannedStart)} → {fmtD(o.plannedEnd)}</Text> },
      { header: "Lote", cell: ({ row: { original: o } }) => <Text size="sm">{o.outputLotCode ?? o.lotCode ?? "—"}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Órdenes de producción"
        description="Liberar reserva materiales; confirmar ingresa el lote en cuarentena; cerrar fija el costo real"
        actions={PRODUCTION_ACTIONS}
        right={can("add_new") && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditor({ open: true, order: null })}>Nueva orden</Button>}
      />
      <Group mb="md" gap="sm">
        <TextInput placeholder="Número, producto o lote" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={260} />
        <Chip.Group multiple={false} value={status} onChange={(v) => (setStatus(v as string), setPage(1))}>
          <Group gap={6}>
            {FILTERS.map((f) => (
              <Chip key={f.value} value={f.value} size="sm" variant="light">{f.label}</Chip>
            ))}
          </Group>
        </Chip.Group>
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(o) => o.id}
        onRowClick={(o) => setDetailId(o.id)}
        emptyText="No hay órdenes con este filtro"
      />
      <OrderEditor opened={editor.open} order={editor.order} onClose={() => setEditor({ open: false, order: null })} onSaved={(o) => setDetailId(o.id)} />
      <OrderDrawer id={detailId} onClose={() => setDetailId(null)} onEdit={(o) => setEditor({ open: true, order: o })} />
    </div>
  );
}
