/**
 * @project FabriHub - Front
 * @file src/app/taxes/withholdings/Page.tsx
 * @description Impuestos → Retenciones (TAX_WITHHOLDINGS): retenciones, tarifas y tramos
 */

import { useEffect, useState } from "react";
import { Accordion, ActionIcon, Badge, Button, Group, Loader, Paper, Select, Switch, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney, fmtPct } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { TAX_ACTIONS } from "@/app/settings/settingsActions";
import { taxesApi } from "../services/taxes.service";
import { BASE_ON_LABEL, WH_KIND_LABEL, type Bracket, type Withholding, type WithholdingRate } from "../types";
import BracketsEditor, { bracketsError } from "./BracketsEditor";

const MODULE = "TAX_WITHHOLDINGS";
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;

function WithholdingModal({ opened, wh, onClose }: Readonly<{ opened: boolean; wh: Withholding | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", description: "", kind: "income", baseOn: "amount" });
  useEffect(() => {
    if (opened) {
      setF({ code: wh?.code ?? "", name: wh?.name ?? "", description: wh?.description ?? "", kind: wh?.kind ?? "income", baseOn: wh?.baseOn ?? "amount" });
    }
  }, [opened, wh]);
  const save = useMutation({
    mutationFn: () =>
      wh
        ? taxesApi.updateWithholding(wh.id, { name: f.name, description: f.description || null, baseOn: f.baseOn })
        : taxesApi.createWithholding({ ...f, description: f.description || null }),
    onSuccess: () => {
      notifySuccess(wh ? "Retención actualizada" : "Retención creada");
      qc.invalidateQueries({ queryKey: ["taxes", "withholdings"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title={wh ? `Editar ${wh.code}` : "Nueva retención"} onSubmit={() => save.mutate()} loading={save.isPending} valid={(Boolean(wh) || CODE_RE.test(f.code)) && f.name.trim().length >= 2}>
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(wh)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <Select label="Naturaleza" disabled={Boolean(wh)} data={Object.entries(WH_KIND_LABEL).map(([value, label]) => ({ value, label }))} value={f.kind} onChange={(v) => setF({ ...f, kind: v ?? "income" })} />
      </Group>
      <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <Select
        label="Se calcula sobre"
        description="IVA: sobre el impuesto causado. ISLR: sobre el monto del pago."
        data={Object.entries(BASE_ON_LABEL).map(([value, label]) => ({ value, label }))}
        value={f.baseOn}
        onChange={(v) => setF({ ...f, baseOn: v ?? "amount" })}
      />
      <Textarea label="Descripción" autosize minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} />
    </FormModal>
  );
}

function RateModal({ target, onClose }: Readonly<{ target: { wh: Withholding; rate: WithholdingRate | null } | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const rate = target?.rate ?? null;
  const [f, setF] = useState({ code: "", name: "", account: "" });
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  useEffect(() => {
    if (target) {
      setF({ code: rate?.code ?? "", name: rate?.name ?? "", account: rate?.account ?? "" });
      setBrackets(rate?.brackets ?? [{ fromAmount: 0, rate: 0, subtrahend: 0 }]);
    }
  }, [target, rate]);
  const save = useMutation({
    mutationFn: () =>
      rate
        ? taxesApi.updateWithholdingRate(rate.id, { name: f.name, account: f.account || null, brackets })
        : taxesApi.createWithholdingRate(target!.wh.id, { code: f.code, name: f.name, account: f.account || null, brackets }),
    onSuccess: () => {
      notifySuccess(rate ? "Tarifa actualizada" : "Tarifa creada");
      qc.invalidateQueries({ queryKey: ["taxes", "withholdings"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal
      opened={Boolean(target)}
      onClose={onClose}
      size="lg"
      title={rate ? `Editar tarifa ${target?.wh.code} · ${rate.code}` : `Nueva tarifa de ${target?.wh.code ?? ""}`}
      onSubmit={() => save.mutate()}
      loading={save.isPending}
      valid={(Boolean(rate) || CODE_RE.test(f.code)) && f.name.trim().length >= 2 && !bracketsError(brackets)}
    >
      <Group grow>
        <TextInput label="Código" required disabled={Boolean(rate)} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} />
        <TextInput label="Cuenta contable" value={f.account} onChange={(e) => setF({ ...f, account: e.currentTarget.value })} />
      </Group>
      <TextInput label="Concepto" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      <BracketsEditor value={brackets} onChange={setBrackets} />
    </FormModal>
  );
}

export default function WithholdingsPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const list = useQuery({ queryKey: ["taxes", "withholdings"], queryFn: taxesApi.listWithholdings });
  const [whModal, setWhModal] = useState<{ open: boolean; wh: Withholding | null }>({ open: false, wh: null });
  const [rateModal, setRateModal] = useState<{ wh: Withholding; rate: WithholdingRate | null } | null>(null);

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxes", "withholdings"] }),
    onError: (err) => notifyError(err)
  });

  return (
    <div className="p-6">
      <ModuleHeader
        title="Retenciones"
        description="Retenciones de IVA e ISLR con tarifas por tramos"
        actions={TAX_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setWhModal({ open: true, wh: null })}>
              Nueva retención
            </Button>
          )
        }
      />
      {list.isLoading && <Loader size="sm" />}

      <div className="space-y-4">
        {(list.data ?? []).map((w) => (
          <Paper key={w.id} withBorder radius="lg" p="lg" className={w.isActive ? "" : "opacity-60"}>
            <Group justify="space-between" align="flex-start" mb="sm">
              <div>
                <Group gap="xs">
                  <Title order={4}>{w.code}</Title>
                  <Badge color="petrol">{WH_KIND_LABEL[w.kind]}</Badge>
                  <Badge color="gray">Base: {BASE_ON_LABEL[w.baseOn]}</Badge>
                </Group>
                <Text fw={600}>{w.name}</Text>
                <Text size="sm" c="dimmed">
                  {w.description}
                </Text>
              </div>
              <Group gap={4}>
                {can("edit") && (
                  <>
                    <Switch size="sm" checked={w.isActive} onChange={() => mutate.mutate(() => taxesApi.updateWithholding(w.id, { isActive: !w.isActive }))} aria-label="Activa" />
                    <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setWhModal({ open: true, wh: w })}>
                      <IconPencil size={18} />
                    </ActionIcon>
                  </>
                )}
                {can("delete") && (
                  <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`la retención ${w.code} y sus tarifas`, () => mutate.mutate(() => taxesApi.deleteWithholding(w.id)))}>
                    <IconTrash size={18} />
                  </ActionIcon>
                )}
              </Group>
            </Group>

            <Accordion variant="separated" radius="md" multiple>
              {w.rates.map((r) => (
                <Accordion.Item key={r.id} value={r.id} className={r.isActive ? "" : "opacity-50"}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="sm">
                      <Text size="sm">
                        <b>{r.code}</b> · {r.name}
                      </Text>
                      <Group gap={6} wrap="nowrap">
                        <Badge size="sm" color="gray">
                          {r.brackets.length === 1 ? fmtPct(r.brackets[0].rate) : `${r.brackets.length} tramos`}
                        </Badge>
                        <Badge size="sm" color={r.treatments ? "petrol" : "gray"}>
                          {r.treatments} uso(s)
                        </Badge>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Table fz="sm" withTableBorder verticalSpacing={4}>
                      <Table.Thead className="bg-gray-50">
                        <Table.Tr>
                          <Table.Th ta="right">Desde</Table.Th>
                          <Table.Th ta="right">%</Table.Th>
                          <Table.Th ta="right">Sustraendo</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {r.brackets.map((b) => (
                          <Table.Tr key={b.fromAmount}>
                            <Table.Td ta="right">{fmtMoney(b.fromAmount)}</Table.Td>
                            <Table.Td ta="right" fw={600}>
                              {fmtPct(b.rate)}
                            </Table.Td>
                            <Table.Td ta="right">{fmtMoney(b.subtrahend)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                    <Group justify="space-between" mt="xs">
                      <Text size="xs" c="dimmed">
                        Cuenta: {r.account ?? "—"}
                      </Text>
                      <Group gap={4}>
                        {can("edit") && (
                          <>
                            <Switch size="xs" label="Activa" checked={r.isActive} onChange={() => mutate.mutate(() => taxesApi.updateWithholdingRate(r.id, { isActive: !r.isActive }))} />
                            <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => setRateModal({ wh: w, rate: r })}>
                              Editar tramos
                            </Button>
                          </>
                        )}
                        {can("delete") && (
                          <ActionIcon variant="subtle" color="red" aria-label="Eliminar tarifa" disabled={r.treatments > 0} onClick={() => confirmDelete(`la tarifa ${w.code} · ${r.code}`, () => mutate.mutate(() => taxesApi.deleteWithholdingRate(r.id)))}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Group>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
            {can("add_new") && (
              <Button variant="subtle" size="xs" mt="xs" leftSection={<IconPlus size={14} />} onClick={() => setRateModal({ wh: w, rate: null })}>
                Agregar tarifa
              </Button>
            )}
          </Paper>
        ))}
      </div>

      <WithholdingModal opened={whModal.open} wh={whModal.wh} onClose={() => setWhModal({ open: false, wh: null })} />
      <RateModal target={rateModal} onClose={() => setRateModal(null)} />
    </div>
  );
}
