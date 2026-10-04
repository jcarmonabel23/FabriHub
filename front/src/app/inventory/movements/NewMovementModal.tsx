/**
 * @project FabriHub - Front
 * @file src/app/inventory/movements/NewMovementModal.tsx
 * @description Alta de movimiento manual: concepto → almacén(es) → líneas (producto, lote, cantidad, costo)
 *
 * El formulario se adapta a la dirección del concepto:
 *  · Entrada: costo unitario obligatorio; lote nuevo (código + vencimiento) o existente.
 *  · Salida / traslado: solo lotes con existencia en el almacén, con su disponible y estado.
 * La API vuelve a validar todo y contabiliza en la BD; aquí solo se guía al usuario.
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconAlertCircle, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ApiError } from "@clients/apiClient";
import { fmtMoney } from "@utils/format";
import { notifySuccess } from "@utils/notify";
import ProductSelect from "../components/ProductSelect";
import { inventoryApi } from "../services/inventory.service";
import { DIRECTION_COLOR, DIRECTION_LABEL, QUALITY_LABEL, type MovementDetail, type ProductOption } from "../types";

interface Line {
  key: number;
  product: ProductOption | null;
  quantity: number | string;
  unitCost: number | string;
  lotMode: "existing" | "new";
  lotId: string | null;
  newLotCode: string;
  newLotExpires: string | null;
}

let seq = 0;
const blankLine = (): Line => ({ key: ++seq, product: null, quantity: "", unitCost: "", lotMode: "new", lotId: null, newLotCode: "", newLotExpires: null });

function LotPicker({ line, warehouseId, isEntry, onChange }: Readonly<{ line: Line; warehouseId: string | null; isEntry: boolean; onChange: (l: Partial<Line>) => void }>) {
  const options = useQuery({
    queryKey: ["inventory", "lot-options", line.product?.id, warehouseId],
    queryFn: () => inventoryApi.lotOptions(line.product!.id, warehouseId!),
    enabled: Boolean(line.product?.isLotControlled && warehouseId && (!isEntry || line.lotMode === "existing"))
  });
  if (!line.product?.isLotControlled) return <Text size="xs" c="dimmed">Sin lote</Text>;

  const select = (
    <Select
      size="xs"
      placeholder={warehouseId ? "Lote" : "Elija almacén"}
      disabled={!warehouseId}
      data={(options.data ?? []).map((o) => ({
        value: o.id,
        label: `${o.lotCode} · ${fmtMoney(o.available, 2)} disp.${o.expiresOn ? ` · vence ${dayjs(o.expiresOn).format("DD/MM/YY")}` : ""}${o.qualityStatus !== "approved" ? ` · ${QUALITY_LABEL[o.qualityStatus]}` : ""}${o.expired ? " · VENCIDO" : ""}`
      }))}
      value={line.lotId}
      onChange={(v) => onChange({ lotId: v })}
      nothingFoundMessage="Sin lotes con existencia"
    />
  );
  if (!isEntry) return select;

  return (
    <Stack gap={4}>
      <SegmentedControl
        size="xs"
        data={[
          { value: "new", label: "Lote nuevo" },
          { value: "existing", label: "Existente" }
        ]}
        value={line.lotMode}
        onChange={(v) => onChange({ lotMode: v as Line["lotMode"], lotId: null })}
      />
      {line.lotMode === "existing" ? (
        select
      ) : (
        <Group gap={4} wrap="nowrap">
          <TextInput size="xs" placeholder="Código" value={line.newLotCode} onChange={(e) => onChange({ newLotCode: e.currentTarget.value })} />
          <DateInput
            size="xs"
            placeholder={line.product.shelfLifeDays ? `Vence (sug. +${line.product.shelfLifeDays} d)` : "Vence"}
            clearable
            valueFormat="DD/MM/YYYY"
            value={line.newLotExpires}
            onChange={(v) => onChange({ newLotExpires: v })}
          />
        </Group>
      )}
    </Stack>
  );
}

export default function NewMovementModal({ opened, onClose, onCreated }: Readonly<{ opened: boolean; onClose: () => void; onCreated: (m: MovementDetail) => void }>) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["inventory", "movement-form-options"], queryFn: inventoryApi.formOptions, enabled: opened });
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setConceptId(null);
      setWarehouseId(options.data?.warehouses.length === 1 ? options.data.warehouses[0].id : null);
      setTargetId(null);
      setDate(dayjs().format("YYYY-MM-DD"));
      setReference("");
      setNotes("");
      setLines([blankLine()]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const concept = options.data?.concepts.find((c) => c.id === conceptId);
  const isEntry = concept?.direction === "in";
  const isTransfer = concept?.direction === "transfer";
  const whOptions = (options.data?.warehouses ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const lineErrors = useMemo(
    () =>
      lines.map((l) => {
        if (!l.product) return "Producto";
        if (!(Number(l.quantity) > 0)) return "Cantidad";
        if (isEntry && l.unitCost === "") return "Costo";
        if (l.product.isLotControlled) {
          if (isEntry && l.lotMode === "new" && !/^[A-Za-z0-9._/-]{1,40}$/.test(l.newLotCode)) return "Lote";
          if ((!isEntry || l.lotMode === "existing") && !l.lotId) return "Lote";
        }
        return null;
      }),
    [lines, isEntry]
  );
  const total = isEntry ? lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0) : null;
  const valid = Boolean(concept && warehouseId && date && (!isTransfer || (targetId && targetId !== warehouseId))) && lineErrors.every((e) => !e);

  const save = useMutation({
    mutationFn: () =>
      inventoryApi.createMovement({
        conceptId,
        movementDate: date,
        warehouseId,
        targetWarehouseId: isTransfer ? targetId : null,
        reference: reference || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          productId: l.product!.id,
          quantity: Number(l.quantity),
          unitCost: isEntry ? Number(l.unitCost) : undefined,
          lotId: l.product!.isLotControlled && (!isEntry || l.lotMode === "existing") ? l.lotId : undefined,
          newLot: l.product!.isLotControlled && isEntry && l.lotMode === "new" ? { lotCode: l.newLotCode, expiresOn: l.newLotExpires } : undefined
        }))
      }),
    onSuccess: (m) => {
      notifySuccess(`Movimiento ${m.number} contabilizado`);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onCreated(m);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento")
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Nuevo movimiento de inventario" size="90rem">
      <Stack>
        <Group grow align="flex-start">
          <Select
            label="Concepto"
            required
            searchable
            data={(options.data?.concepts ?? []).map((c) => ({ value: c.id, label: `${c.name} (${DIRECTION_LABEL[c.direction]})` }))}
            value={conceptId}
            onChange={(v) => {
              setConceptId(v);
              setLines([blankLine()]);
              setError(null);
            }}
          />
          <Select label={isTransfer ? "Almacén origen" : "Almacén"} required data={whOptions} value={warehouseId} onChange={setWarehouseId} />
          {isTransfer && <Select label="Almacén destino" required data={whOptions.filter((w) => w.value !== warehouseId)} value={targetId} onChange={setTargetId} />}
          <DateInput label="Fecha" required valueFormat="DD/MM/YYYY" maxDate={dayjs().format("YYYY-MM-DD")} value={date} onChange={setDate} />
          <TextInput label="Referencia" placeholder="Conteo, documento…" value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
        </Group>
        {concept && (
          <Group gap="xs">
            <Badge color={DIRECTION_COLOR[concept.direction]}>{DIRECTION_LABEL[concept.direction]}</Badge>
            <Text size="sm" c="dimmed">
              {concept.description}
              {isEntry && ` · Los lotes nuevos entran ${concept.lotStatusOnEntry === "approved" ? "liberados" : "en cuarentena"}.`}
              {!isEntry && !concept.allowsUnapprovedLots && " · Solo lotes liberados y vigentes."}
              {!isEntry && concept.allowsUnapprovedLots && " · Permite sacar lotes retenidos o vencidos."}
              {!isEntry && " · Sale al costo promedio del almacén."}
            </Text>
          </Group>
        )}

        <Paper withBorder radius="md" className="overflow-x-auto">
          <Table verticalSpacing="xs" miw={980}>
            <Table.Thead className="bg-gray-50">
              <Table.Tr>
                <Table.Th w={40}>#</Table.Th>
                <Table.Th w={340}>Producto</Table.Th>
                <Table.Th w={300}>Lote</Table.Th>
                <Table.Th w={140}>Cantidad</Table.Th>
                {isEntry && <Table.Th w={140}>Costo unitario</Table.Th>}
                {isEntry && <Table.Th w={120} ta="right">Total</Table.Th>}
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={l.key}>
                  <Table.Td>
                    <Text size="sm" c={lineErrors[i] && l.product ? "red" : undefined}>
                      {i + 1}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ProductSelect size="xs" stockable value={l.product} onChange={(p) => setLine(l.key, { product: p, lotId: null, newLotCode: "" })} />
                    {l.product?.isOnHold && (
                      <Text size="xs" c="red">
                        Producto retenido
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <LotPicker line={l} warehouseId={warehouseId} isEntry={isEntry} onChange={(p) => setLine(l.key, p)} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      decimalScale={l.product?.unitDecimals ?? 2}
                      decimalSeparator=","
                      thousandSeparator="."
                      rightSection={<Text size="xs" c="dimmed" pr={6}>{l.product?.unitCode}</Text>}
                      rightSectionWidth={50}
                      value={l.quantity}
                      onChange={(v) => setLine(l.key, { quantity: v })}
                    />
                  </Table.Td>
                  {isEntry && (
                    <Table.Td>
                      <NumberInput size="xs" min={0} decimalScale={6} decimalSeparator="," thousandSeparator="." value={l.unitCost} onChange={(v) => setLine(l.key, { unitCost: v })} />
                    </Table.Td>
                  )}
                  {isEntry && (
                    <Table.Td ta="right">
                      <Text size="sm">{fmtMoney((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label="Quitar línea" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
        <Group justify="space-between">
          <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} disabled={!concept || lines.length >= 200} onClick={() => setLines([...lines, blankLine()])}>
            Agregar línea
          </Button>
          {total !== null && (
            <Text fw={700}>
              Total: <span className="font-mono">{fmtMoney(total)}</span>
            </Text>
          )}
        </Group>

        <Textarea label="Observaciones" autosize minRows={1} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Al contabilizar, el movimiento no se puede editar ni borrar: solo reversar.
          </Text>
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
              Contabilizar
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
