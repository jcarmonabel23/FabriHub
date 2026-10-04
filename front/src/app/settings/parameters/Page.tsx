/**
 * @project FabriHub - Front
 * @file src/app/settings/parameters/Page.tsx
 * @description Parámetros → Parámetros (SET_PARAMETERS): valores por módulo y correlativos
 *
 * Cada parámetro se edita con el control de su tipo y se guarda al confirmar (no hay un
 * "Guardar todo": un cambio aquí afecta a todos los usuarios y queda auditado uno por uno).
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, NumberInput, Paper, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconCheck, IconHash, IconPencil, IconSettings } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "../services/settings.service";
import { SETTINGS_ACTIONS } from "../settingsActions";
import type { Parameter, Sequence } from "../types";

function ParameterRow({ p, canEdit }: Readonly<{ p: Parameter; canEdit: boolean }>) {
  const qc = useQueryClient();
  const [value, setValue] = useState<unknown>(p.value);
  useEffect(() => setValue(p.value), [p.value]);

  const dirty = JSON.stringify(value) !== JSON.stringify(p.value);
  const isDefault = JSON.stringify(p.value) === JSON.stringify(p.defaultValue);

  const onSaved = (data: Parameter) => {
    qc.setQueryData<Parameter[]>(["settings", "parameters"], (old) => old?.map((x) => (x.id === data.id ? data : x)));
    notifySuccess(`«${p.name}» actualizado`);
  };
  const save = useMutation({ mutationFn: (v: unknown) => settingsApi.updateParameter(p.id, v), onSuccess: onSaved, onError: (err) => notifyError(err) });
  const reset = useMutation({ mutationFn: () => settingsApi.resetParameter(p.id), onSuccess: onSaved, onError: (err) => notifyError(err) });

  let control;
  switch (p.dataType) {
    case "boolean":
      control = (
        <Switch
          checked={Boolean(value)}
          disabled={!canEdit || save.isPending}
          onChange={(e) => {
            setValue(e.currentTarget.checked);
            save.mutate(e.currentTarget.checked);
          }}
          aria-label={p.name}
        />
      );
      break;
    case "select":
      control = (
        <Select
          w={260}
          data={p.rules.options ?? []}
          value={String(value)}
          disabled={!canEdit}
          onChange={(v) => {
            setValue(v);
            save.mutate(v);
          }}
        />
      );
      break;
    case "integer":
    case "number":
      control = (
        <NumberInput
          w={160}
          min={p.rules.min}
          max={p.rules.max}
          allowDecimal={p.dataType === "number"}
          decimalSeparator=","
          value={value as number}
          disabled={!canEdit}
          onChange={(v) => setValue(typeof v === "number" ? v : 0)}
        />
      );
      break;
    default:
      control = <TextInput w={260} value={String(value ?? "")} disabled={!canEdit} onChange={(e) => setValue(e.currentTarget.value)} />;
  }

  return (
    <Group justify="space-between" wrap="nowrap" py="sm" className="border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <Text size="sm" fw={600}>
          {p.name} {!isDefault && <Badge size="xs" color="orange">Modificado</Badge>}
        </Text>
        <Text size="xs" c="dimmed">
          {p.description}
          {(p.rules.min !== undefined || p.rules.max !== undefined) && ` (${p.rules.min ?? "…"} a ${p.rules.max ?? "…"})`}
        </Text>
        {p.updatedBy && (
          <Text size="xs" c="dimmed">
            Cambiado por {p.updatedBy} · {fmtDateTime(p.updatedAt)}
          </Text>
        )}
      </div>
      <Group gap="xs" wrap="nowrap">
        {control}
        {canEdit && dirty && p.dataType !== "boolean" && p.dataType !== "select" && (
          <Tooltip label="Guardar">
            <ActionIcon onClick={() => save.mutate(value)} loading={save.isPending} aria-label="Guardar">
              <IconCheck size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {canEdit && !isDefault && (
          <Tooltip label="Restaurar valor de fábrica">
            <ActionIcon variant="subtle" color="gray" onClick={() => reset.mutate()} loading={reset.isPending} aria-label="Restaurar">
              <IconArrowBackUp size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}

function SequenceModal({ seq, onClose }: Readonly<{ seq: Sequence | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState("");
  const [padding, setPadding] = useState(6);
  const [next, setNext] = useState(1);
  useEffect(() => {
    if (seq) {
      setPrefix(seq.prefix);
      setPadding(seq.padding);
      setNext(seq.nextNumber);
    }
  }, [seq]);

  const save = useMutation({
    mutationFn: () => settingsApi.updateSequence(seq!.docType, { prefix, padding, nextNumber: next }),
    onSuccess: () => {
      notifySuccess("Correlativo actualizado");
      qc.invalidateQueries({ queryKey: ["settings", "sequences"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const preview = `${prefix}${String(next).padStart(padding, "0")}`;
  const backwards = seq ? next < seq.nextNumber : false;

  return (
    <FormModal opened={Boolean(seq)} onClose={onClose} title={`Correlativo · ${seq?.name ?? ""}`} onSubmit={() => save.mutate()} loading={save.isPending} valid={!backwards && /^[A-Z0-9-]{0,10}$/.test(prefix)}>
      <Group grow>
        <TextInput label="Prefijo" maxLength={10} value={prefix} onChange={(e) => setPrefix(e.currentTarget.value.toUpperCase())} />
        <NumberInput label="Dígitos" min={1} max={12} value={padding} onChange={(v) => setPadding(Number(v) || 1)} />
        <NumberInput
          label="Próximo número"
          min={1}
          value={next}
          onChange={(v) => setNext(Number(v) || 1)}
          error={backwards ? "No puede retroceder: repetiría documentos" : null}
        />
      </Group>
      <Paper withBorder p="sm" radius="md" className="bg-brand-50">
        <Text size="sm">
          Próximo documento: <b className="font-mono">{preview}</b>
        </Text>
      </Paper>
    </FormModal>
  );
}

export default function ParametersPage() {
  const can = useCan("SET_PARAMETERS");
  const params = useQuery({ queryKey: ["settings", "parameters"], queryFn: settingsApi.listParameters });
  const sequences = useQuery({ queryKey: ["settings", "sequences"], queryFn: settingsApi.listSequences });
  const [editingSeq, setEditingSeq] = useState<Sequence | null>(null);

  const groups = useMemo(() => {
    const out = new Map<string, Parameter[]>();
    for (const p of params.data ?? []) {
      if (!out.has(p.moduleName)) out.set(p.moduleName, []);
      out.get(p.moduleName)!.push(p);
    }
    return [...out.entries()];
  }, [params.data]);

  return (
    <div className="p-6">
      <ModuleHeader title="Parámetros" description="Comportamiento de cada módulo y numeración de documentos" actions={SETTINGS_ACTIONS} />
      <Tabs defaultValue="params">
        <Tabs.List mb="md">
          <Tabs.Tab value="params" leftSection={<IconSettings size={16} />}>
            Parámetros por módulo
          </Tabs.Tab>
          <Tabs.Tab value="sequences" leftSection={<IconHash size={16} />}>
            Correlativos
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="params">
          <Stack gap="md" maw={980}>
            {groups.map(([module, items]) => (
              <Paper key={module} withBorder radius="lg" px="lg" py="sm">
                <Title order={6} tt="uppercase" c="petrol.8" mt="xs">
                  {module}
                </Title>
                {items.map((p) => (
                  <ParameterRow key={p.id} p={p} canEdit={can("configure")} />
                ))}
              </Paper>
            ))}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="sequences">
          <Paper withBorder radius="lg" maw={980} className="overflow-hidden">
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead className="bg-gray-50">
                <Table.Tr>
                  <Table.Th>Documento</Table.Th>
                  <Table.Th>Módulo</Table.Th>
                  <Table.Th>Próximo número</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sequences.data ?? []).map((s) => (
                  <Table.Tr key={s.docType}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {s.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {s.docType}
                      </Text>
                    </Table.Td>
                    <Table.Td>{s.moduleName}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" fw={600}>
                        {s.preview}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      {can("configure") && (
                        <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => setEditingSeq(s)}>
                          Configurar
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Tabs.Panel>
      </Tabs>
      <SequenceModal seq={editingSeq} onClose={() => setEditingSeq(null)} />
    </div>
  );
}
