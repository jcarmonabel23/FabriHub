/**
 * @project FabriHub - Front
 * @file src/app/production/planning/Page.tsx
 * @description Producción → Planificación (PRD_PLANNING): plan de ventas → plan maestro (MPS) → MRP → órdenes sugeridas
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, NumberInput, Paper, Select, Stack, Table, Tabs, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconAlertTriangle, IconBan, IconCalculator, IconDeviceFloppy, IconHistory, IconLock, IconLockOpen, IconPlayerPlay, IconPlus, IconTrash, IconWand, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCan, useCanAccess } from "@modules/access-control/useCan";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { settingsApi } from "@/app/settings/services/settings.service";
import { confirmDelete } from "@utils/confirm";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { planningApi, type MrpRun, type PlanProduct, type Plans, type Suggestion } from "./planning.service";

const MODULE = "PRD_PLANNING";
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);
const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

// ------------------------------------------------------------------ Grilla mensual

function PlanGrid({ plans, type, editable, onSaved }: Readonly<{ plans: Plans; type: "sales" | "mps"; editable: boolean; onSaved: () => void }>) {
  const first = plans.firstMonth ?? 13;
  const rows = plans.products.filter((p) => (type === "sales" ? p.sales.some((q) => q > 0) || !p.mps.some((q) => q > 0) : p.isManufactured));
  const [draft, setDraft] = useState<Record<string, number[]>>({});
  const [adding, setAdding] = useState<ProductOption | null>(null);
  useEffect(() => setDraft({}), [plans]);
  const valueOf = (p: PlanProduct) => draft[p.id] ?? p[type];
  const set = (p: PlanProduct, m: number, v: number) => setDraft((d) => ({ ...d, [p.id]: valueOf(p).map((x, i) => (i === m ? v : x)) }));
  const dirty = Object.keys(draft);
  const save = useMutation({
    mutationFn: (extra?: { productId: string; months: number[] }) =>
      planningApi.savePlans(plans.period.id, type, [...dirty.map((productId) => ({ productId, months: draft[productId] })), ...(extra ? [extra] : [])]),
    onSuccess: () => {
      notifySuccess(type === "sales" ? "Plan de ventas guardado" : "Plan maestro guardado");
      setAdding(null);
      onSaved();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({ mutationFn: (pid: string) => planningApi.removeProduct(plans.period.id, pid), onSuccess: onSaved, onError: (err) => notifyError(err) });

  return (
    <Stack gap="sm">
      <Paper withBorder radius="md" className="overflow-x-auto">
        <Table verticalSpacing={4} horizontalSpacing={6} miw={1300} fz="sm">
          <Table.Thead className="bg-gray-50">
            <Table.Tr>
              <Table.Th w={230}>Producto</Table.Th>
              {MONTHS.map((m, i) => (
                <Table.Th key={m} ta="right" c={i + 1 < first ? "dimmed" : undefined}>{m}</Table.Th>
              ))}
              <Table.Th ta="right">Total</Table.Th>
              {editable && <Table.Th w={36} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((p) => (
              <Fragment key={p.id}>
                <Table.Tr>
                  <Table.Td>
                    <Text size="sm" fw={600}>{p.code}</Text>
                    <Text size="xs" c="dimmed">
                      {type === "mps"
                        ? `Disp. ${qty(p.available)} · seguridad ${qty(p.safetyStock)} · lote ${p.lotSize ? qty(p.lotSize) : "sin fórmula"}`
                        : `${p.name.slice(0, 32)} · ${p.unitCode}`}
                    </Text>
                  </Table.Td>
                  {valueOf(p).map((v, i) => (
                    <Table.Td key={i} ta="right">
                      {editable && i + 1 >= first ? (
                        <NumberInput size="xs" hideControls min={0} w={74} thousandSeparator="." decimalSeparator="," value={v} onChange={(x) => set(p, i, Number(x) || 0)} styles={{ input: { textAlign: "right" } }} />
                      ) : (
                        <Text size="sm" c={i + 1 < first ? "dimmed" : undefined}>{v ? qty(v) : "—"}</Text>
                      )}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right" fw={700}>{qty(sum(valueOf(p)))}</Table.Td>
                  {editable && (
                    <Table.Td>
                      {type === "sales" && (
                        <ActionIcon variant="subtle" color="red" aria-label="Quitar" onClick={() => confirmDelete(`${p.code} del período`, () => remove.mutate(p.id))}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
                {type === "mps" && (
                  <Table.Tr className="bg-gray-50">
                    <Table.Td><Text size="xs" c="dimmed" pl="xs">Plan de ventas</Text></Table.Td>
                    {p.sales.map((v, i) => (
                      <Table.Td key={i} ta="right"><Text size="xs" c="dimmed">{v ? qty(v) : ""}</Text></Table.Td>
                    ))}
                    <Table.Td ta="right"><Text size="xs" c="dimmed">{qty(sum(p.sales))}</Text></Table.Td>
                    {editable && <Table.Td />}
                  </Table.Tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={15}>
                  <Text size="sm" c="dimmed" ta="center" py="md">{type === "sales" ? "Agregue productos al plan de ventas" : "Genere el plan maestro desde el plan de ventas"}</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {editable && (
        <Group justify="space-between">
          {type === "sales" ? (
            <Group gap="xs">
              <ProductSelect size="xs" only="sold" stockable value={adding} onChange={setAdding} w={340} excludeIds={rows.map((r) => r.id)} placeholder="Agregar producto al plan" />
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} disabled={!adding} loading={save.isPending} onClick={() => adding && save.mutate({ productId: adding.id, months: Array(12).fill(0) })}>
                Agregar
              </Button>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">Ajuste las cantidades si la planta lo requiere; el MRP usa este plan maestro.</Text>
          )}
          <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} disabled={dirty.length === 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Guardar cambios ({dirty.length})
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ MRP

const ROWS: { key: keyof MrpRun["results"][number]["buckets"][number]; label: string; strong?: boolean }[] = [
  { key: "gross", label: "Necesidades brutas" },
  { key: "scheduled", label: "Recepciones programadas" },
  { key: "projected", label: "Disponible proyectado", strong: true },
  { key: "net", label: "Necesidades netas" },
  { key: "receipt", label: "Recepción planificada" },
  { key: "release", label: "Lanzamiento planificado", strong: true }
];

function MrpTable({ run }: Readonly<{ run: MrpRun }>) {
  const months = Array.from({ length: run.months }, (_, i) => run.firstMonth + i);
  return (
    <Paper withBorder radius="md" className="overflow-x-auto">
      <Table verticalSpacing={2} fz="xs" miw={760}>
        <Table.Thead className="bg-gray-50">
          <Table.Tr>
            <Table.Th w={260}>Producto (nivel · reposición)</Table.Th>
            <Table.Th w={200} />
            {months.map((m) => (
              <Table.Th key={m} ta="right">{MONTHS[m - 1]}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {run.results.map((r) =>
            ROWS.map((row, i) => (
              <Table.Tr key={`${r.productId}-${row.key}`} className={i === ROWS.length - 1 ? "border-b-2 border-gray-200" : undefined}>
                {i === 0 && (
                  <Table.Td rowSpan={ROWS.length} style={{ verticalAlign: "top" }}>
                    <Text size="sm" fw={700}>{r.code}</Text>
                    <Text size="xs" c="dimmed">{r.name}</Text>
                    <Group gap={4} mt={4}>
                      <Badge size="xs" variant="light">Nivel {r.level}</Badge>
                      <Badge size="xs" variant="light" color="gray">{r.leadDays} d</Badge>
                      <Badge size="xs" variant="outline" color="gray">{r.unitCode}</Badge>
                    </Group>
                  </Table.Td>
                )}
                <Table.Td><Text size="xs" fw={row.strong ? 700 : 400}>{row.label}</Text></Table.Td>
                {r.buckets.map((b) => {
                  const v = b[row.key];
                  const negative = row.key === "projected" && v < 0;
                  return (
                    <Table.Td key={b.month} ta="right">
                      <Text size="xs" fw={row.strong && v ? 700 : 400} c={negative ? "red" : row.key === "release" && v ? "petrol.7" : v ? undefined : "dimmed"}>
                        {v ? qty(v) : "·"}
                      </Text>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function SuggestionsTable({ run, canConvert, onChange }: Readonly<{ run: MrpRun; canConvert: boolean; onChange: (r: MrpRun) => void }>) {
  const navigate = useNavigate();
  const canAccess = useCanAccess();
  const suppliers = useQuery({ queryKey: ["lookup", "suppliers"], queryFn: () => settingsApi.lookup("suppliers") });
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected([]), [run.id]);
  const open = run.suggestions.filter((s) => s.status === "open");
  const update = useMutation({ mutationFn: ({ id, b }: { id: string; b: Record<string, unknown> }) => planningApi.updateSuggestion(id, b), onSuccess: onChange, onError: (err) => notifyError(err) });
  const dismiss = useMutation({ mutationFn: (id: string) => planningApi.dismiss(id), onSuccess: onChange, onError: (err) => notifyError(err) });
  const convert = useMutation({
    mutationFn: () => planningApi.convert(selected),
    onSuccess: (r) => {
      notifySuccess(`Documentos creados: ${r.documents.map((d) => d.number).join(", ")}`);
      setSelected([]);
      onChange(r.run);
    },
    onError: (err) => notifyError(err)
  });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const docLink = (s: Suggestion) => (s.documentModule === "PRODUCTION" ? "/production/orders" : "/purchases/orders");

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {open.length} abiertas · {run.suggestions.filter((s) => s.status === "converted").length} convertidas · {run.suggestions.filter((s) => s.status === "dismissed").length} descartadas
        </Text>
        {canConvert && (
          <Group gap="xs">
            <Checkbox label="Todas las abiertas" checked={open.length > 0 && selected.length === open.length} indeterminate={selected.length > 0 && selected.length < open.length} onChange={(e) => setSelected(e.currentTarget.checked ? open.map((s) => s.id) : [])} />
            <Button size="xs" leftSection={<IconWand size={14} />} disabled={selected.length === 0} loading={convert.isPending} onClick={() => convert.mutate()}>
              Convertir en órdenes ({selected.length})
            </Button>
          </Group>
        )}
      </Group>
      <Paper withBorder radius="md" className="overflow-x-auto">
        <Table fz="sm" verticalSpacing={4} miw={1050}>
          <Table.Thead className="bg-gray-50">
            <Table.Tr>
              <Table.Th w={32} />
              <Table.Th>Acción</Table.Th>
              <Table.Th>Producto</Table.Th>
              <Table.Th ta="right">Cantidad</Table.Th>
              <Table.Th>Emitir</Table.Th>
              <Table.Th>Se necesita</Table.Th>
              <Table.Th w={260}>Proveedor / almacén</Table.Th>
              <Table.Th>Estado</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {run.suggestions.map((s) => (
              <Table.Tr key={s.id} opacity={s.status === "dismissed" ? 0.5 : 1}>
                <Table.Td>{s.status === "open" && canConvert && <Checkbox checked={selected.includes(s.id)} onChange={() => toggle(s.id)} aria-label="Seleccionar" />}</Table.Td>
                <Table.Td>
                  <Badge color={s.kind === "make" ? "violet" : "blue"} variant="light">{s.kind === "make" ? "Fabricar" : "Comprar"}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>{s.productCode}</Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>{s.productName}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm" fw={600}>{qty(s.quantity)} {s.unitCode}</Text>
                  <Text size="xs" c="dimmed">
                    neta {qty(s.netQuantity)}
                    {s.kind === "buy" && s.purchaseUnitCode && s.purchaseFactor !== 1 ? ` · ${qty(s.quantity / s.purchaseFactor)} ${s.purchaseUnitCode}` : ""}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={s.isLate ? "red" : undefined} fw={s.isLate ? 700 : undefined}>{dayjs(s.releaseDate).format("DD/MM/YYYY")}</Text>
                  {s.isLate && s.status === "open" && <Text size="xs" c="red">Atrasada: agilizar</Text>}
                </Table.Td>
                <Table.Td>{dayjs(s.dueDate).format("DD/MM/YYYY")}</Table.Td>
                <Table.Td>
                  {s.kind === "buy" && s.status === "open" && canConvert ? (
                    <Select
                      size="xs"
                      placeholder="Elegir proveedor"
                      searchable
                      data={(suppliers.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
                      value={s.supplierId}
                      onChange={(v) => update.mutate({ id: s.id, b: { supplierId: v } })}
                      error={!s.supplierId ? "Requerido para convertir" : undefined}
                    />
                  ) : (
                    <Text size="xs">{s.kind === "buy" ? s.supplierName ?? "—" : "Planta"}</Text>
                  )}
                  <Text size="xs" c="dimmed">Almacén {s.warehouseCode ?? "—"}</Text>
                </Table.Td>
                <Table.Td>
                  {s.status === "open" ? (
                    canConvert && (
                      <Tooltip label="Descartar">
                        <ActionIcon variant="subtle" color="gray" aria-label="Descartar" onClick={() => dismiss.mutate(s.id)}>
                          <IconX size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )
                  ) : s.status === "converted" ? (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={!canAccess(s.documentModule === "PRODUCTION" ? "PRD_ORDERS" : "PUR_ORDERS")}
                      onClick={() => navigate(docLink(s))}
                    >
                      {s.documentNumber}
                    </Button>
                  ) : (
                    <Badge size="xs" color="gray">Descartada</Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

function MrpTab({ periodId, open }: Readonly<{ periodId: string; open: boolean }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const runs = useQuery({ queryKey: ["planning", "runs", periodId], queryFn: () => planningApi.runs(periodId) });
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => setRunId(runs.data?.[0]?.id ?? null), [runs.data]);
  const run = useQuery({ queryKey: ["planning", "run", runId], queryFn: () => planningApi.run(runId!), enabled: Boolean(runId) });
  const exec = useMutation({
    mutationFn: () => planningApi.runMrp(periodId),
    onSuccess: (r) => {
      notifySuccess(`MRP calculado: ${r.products} productos, ${r.suggestions.length} órdenes sugeridas`);
      qc.setQueryData(["planning", "run", r.id], r);
      qc.invalidateQueries({ queryKey: ["planning", "runs", periodId] });
      qc.invalidateQueries({ queryKey: ["planning", "periods"] });
      setRunId(r.id);
    },
    onError: (err) => notifyError(err)
  });
  const r = run.data;

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="xs">
          {open && can("add_new") && (
            <Button leftSection={<IconCalculator size={16} />} loading={exec.isPending} onClick={() => exec.mutate()}>
              Correr MRP
            </Button>
          )}
          {(runs.data?.length ?? 0) > 0 && (
            <Select
              size="sm"
              leftSection={<IconHistory size={14} />}
              w={330}
              data={(runs.data ?? []).map((x) => ({ value: x.id, label: `${fmtDateTime(x.runAt)} · ${x.suggestions} sugerencias · ${x.converted} convertidas` }))}
              value={runId}
              onChange={setRunId}
              allowDeselect={false}
            />
          )}
        </Group>
        {r && (
          <Text size="xs" c="dimmed">
            {MONTHS[r.firstMonth - 1]}–{MONTHS[r.firstMonth + r.months - 2]} {r.year} · por {r.runBy} · programadas: {r.params.scheduledPurchaseLines} líneas de OC, {r.params.scheduledProductionOrders} OP
            {r.params.quarantineProducts ? `, ${r.params.quarantineProducts} producto(s) en cuarentena` : ""}
          </Text>
        )}
      </Group>
      {!runId && !runs.isLoading && <Alert variant="light" color="gray">Aún no se ha corrido el MRP en este período.</Alert>}
      {run.isLoading && <Loader size="sm" />}
      {r && (
        <Tabs defaultValue="suggestions" keepMounted={false} variant="pills">
          <Tabs.List mb="sm">
            <Tabs.Tab value="suggestions">Órdenes sugeridas ({r.suggestions.length})</Tabs.Tab>
            <Tabs.Tab value="table">Tabla MRP ({r.results.length} productos)</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="suggestions">
            <SuggestionsTable run={r} canConvert={open && can("add_new")} onChange={(x) => qc.setQueryData(["planning", "run", x.id], x)} />
          </Tabs.Panel>
          <Tabs.Panel value="table">
            <MrpTable run={r} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ Página

function PeriodModal({ opened, onClose, onCreated, periods }: Readonly<{ opened: boolean; onClose: () => void; onCreated: (id: string) => void; periods: { id: string; code: string }[] }>) {
  const next = dayjs().year() + 1;
  const [f, setF] = useState({ code: "", name: "", year: next as number | string, copyFromId: null as string | null });
  useEffect(() => {
    if (opened) setF({ code: `P${next}`, name: `Plan ${next}`, year: next, copyFromId: periods[0]?.id ?? null });
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => planningApi.createPeriod({ code: f.code, name: f.name, year: Number(f.year), copyFromId: f.copyFromId }),
    onSuccess: (p) => {
      notifySuccess(`Período ${p.code} creado`);
      onCreated(p.id);
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title="Nuevo período" onSubmit={() => save.mutate()} loading={save.isPending} valid={/^[A-Za-z0-9_-]{1,20}$/.test(f.code) && f.name.trim().length >= 2 && Number(f.year) >= 2000}>
      <Group grow>
        <TextInput label="Código" required value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <NumberInput label="Año" required min={2000} max={2100} value={f.year} onChange={(v) => setF({ ...f, year: v })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <Select label="Copiar plan de ventas de" clearable data={periods.map((p) => ({ value: p.id, label: p.code }))} value={f.copyFromId} onChange={(v) => setF({ ...f, copyFromId: v })} />
    </FormModal>
  );
}

function HistoryModal({ periodId, opened, onClose, onDone }: Readonly<{ periodId: string; opened: boolean; onClose: () => void; onDone: () => void }>) {
  const [months, setMonths] = useState<number | string>(6);
  const [growth, setGrowth] = useState<number | string>(0);
  const run = useMutation({
    mutationFn: () => planningApi.salesFromHistory(periodId, Number(months), Number(growth)),
    onSuccess: (r) => {
      notifySuccess(r.products ? `Plan propuesto para ${r.products} producto(s)` : "No hay despachos en ese lapso");
      onDone();
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Proponer desde lo vendido">
      <Stack>
        <Text size="sm" c="dimmed">Promedio mensual de lo despachado (notas de entrega) en los últimos meses, para los meses que faltan del período.</Text>
        <Group grow>
          <NumberInput label="Meses de historia" min={1} max={24} value={months} onChange={setMonths} />
          <NumberInput label="Crecimiento %" min={-90} max={500} value={growth} onChange={setGrowth} />
        </Group>
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />}>Reemplaza las cantidades de los meses pendientes de esos productos.</Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancelar</Button>
          <Button loading={run.isPending} onClick={() => run.mutate()}>Proponer</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default function PlanningPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const periods = useQuery({ queryKey: ["planning", "periods"], queryFn: planningApi.periods });
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState(false);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    if (!periodId && periods.data?.length) setPeriodId(periods.data[0].id);
  }, [periods.data, periodId]);
  const plans = useQuery({ queryKey: ["planning", "plans", periodId], queryFn: () => planningApi.plans(periodId!), enabled: Boolean(periodId) });
  const period = useMemo(() => periods.data?.find((p) => p.id === periodId), [periods.data, periodId]);
  const open = period?.status === "open" && plans.data?.firstMonth !== null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["planning", "plans", periodId] });
    qc.invalidateQueries({ queryKey: ["planning", "periods"] });
  };
  const mps = useMutation({
    mutationFn: () => planningApi.generateMps(periodId!),
    onSuccess: (r) => {
      notifySuccess(`Plan maestro generado para ${r.generated} producto(s) desde ${MONTHS[r.firstMonth - 1]}${r.skipped.length ? `; sin fórmula: ${r.skipped.join(", ")}` : ""}`);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const periodAct = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning"] }),
    onError: (err) => notifyError(err)
  });

  return (
    <div className="p-6">
      <ModuleHeader
        title="Planificación"
        description="Plan de ventas → plan maestro de producción → MRP → órdenes de producción y de compra"
        actions={PRODUCTION_ACTIONS}
        right={can("add_new") && <Button leftSection={<IconPlus size={16} />} onClick={() => setNewPeriod(true)}>Nuevo período</Button>}
      />
      <Group mb="md" gap="sm">
        <Select
          w={260}
          placeholder="Período"
          data={(periods.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          value={periodId}
          onChange={setPeriodId}
          allowDeselect={false}
        />
        {period && <Badge color={period.status === "open" ? "teal" : "gray"}>{period.status === "open" ? "Abierto" : "Cerrado"}</Badge>}
        {period && plans.data?.firstMonth === null && <Badge color="gray" variant="light">Año pasado: solo consulta</Badge>}
        {period && can("edit") && (
          <Button
            size="xs"
            variant="subtle"
            color="dark"
            leftSection={period.status === "open" ? <IconLock size={14} /> : <IconLockOpen size={14} />}
            onClick={() => periodAct.mutate(() => planningApi.updatePeriod(period.id, { status: period.status === "open" ? "closed" : "open" }))}
          >
            {period.status === "open" ? "Cerrar período" : "Reabrir"}
          </Button>
        )}
        {period && can("delete") && (
          <Button size="xs" variant="subtle" color="red" leftSection={<IconBan size={14} />} onClick={() => confirmDelete(`el período ${period.code}`, () => periodAct.mutate(() => planningApi.deletePeriod(period.id).then(() => setPeriodId(null))))}>
            Eliminar
          </Button>
        )}
      </Group>

      {!periodId ? (
        <Alert variant="light" color="gray">Cree un período para empezar a planificar.</Alert>
      ) : !plans.data ? (
        <Loader size="sm" />
      ) : (
        <Tabs defaultValue="sales" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="sales">1 · Plan de ventas</Tabs.Tab>
            <Tabs.Tab value="mps">2 · Plan maestro (MPS)</Tabs.Tab>
            <Tabs.Tab value="mrp">3 · MRP y órdenes sugeridas</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="sales">
            {open && can("edit") && (
              <Group mb="sm">
                <Button size="xs" variant="light" leftSection={<IconHistory size={14} />} onClick={() => setHistory(true)}>Proponer desde lo vendido</Button>
              </Group>
            )}
            <PlanGrid plans={plans.data} type="sales" editable={Boolean(open && can("edit"))} onSaved={refresh} />
          </Tabs.Panel>
          <Tabs.Panel value="mps">
            {open && can("edit") && (
              <Group mb="sm">
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={14} />}
                  loading={mps.isPending}
                  onClick={() =>
                    plans.data.products.some((p) => p.mps.some((q) => q > 0))
                      ? modals.openConfirmModal({
                          title: "Regenerar plan maestro",
                          children: <Text size="sm">Se recalcula desde el plan de ventas y se pierden los ajustes manuales de los meses pendientes.</Text>,
                          labels: { confirm: "Regenerar", cancel: "Cancelar" },
                          onConfirm: () => mps.mutate()
                        })
                      : mps.mutate()
                  }
                >
                  Generar desde el plan de ventas
                </Button>
                <Text size="xs" c="dimmed">Producción = lo necesario para no bajar del stock de seguridad, en lotes de la fórmula.</Text>
              </Group>
            )}
            <PlanGrid plans={plans.data} type="mps" editable={Boolean(open && can("edit"))} onSaved={refresh} />
          </Tabs.Panel>
          <Tabs.Panel value="mrp">
            <MrpTab periodId={periodId} open={Boolean(open)} />
          </Tabs.Panel>
        </Tabs>
      )}
      <PeriodModal opened={newPeriod} onClose={() => setNewPeriod(false)} onCreated={(id) => (setPeriodId(id), qc.invalidateQueries({ queryKey: ["planning", "periods"] }))} periods={periods.data ?? []} />
      {periodId && <HistoryModal periodId={periodId} opened={history} onClose={() => setHistory(false)} onDone={refresh} />}
    </div>
  );
}
