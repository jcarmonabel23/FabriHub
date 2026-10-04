/**
 * @project FabriHub - Front
 * @file src/app/purchases/receptions/ReceiveModal.tsx
 * @description Recibir mercancía de una orden: cantidades pendientes, lote, vencimiento y lote del proveedor
 */

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconAlertCircle, IconShieldCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ApiError } from "@clients/apiClient";
import { fmtMoney } from "@utils/format";
import { notifySuccess } from "@utils/notify";
import { purchasesApi } from "../services/purchases.service";
import type { ReceptionDetail } from "../types";

interface LineState {
  quantity: number | string;
  lotCode: string;
  expiresOn: string | null;
  supplierLot: string;
}

export default function ReceiveModal({ orderId, onClose, onDone }: Readonly<{ orderId: string | null; onClose: () => void; onDone: (r: ReceptionDetail) => void }>) {
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ["purchases", "reception-order", orderId], queryFn: () => purchasesApi.orderForReception(orderId!), enabled: Boolean(orderId) });
  const [date, setDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!order.data) return;
    setError(null);
    setDeliveryNote("");
    setNotes("");
    setLines(
      Object.fromEntries(order.data.lines.filter((l) => l.quantityPending > 0).map((l) => [l.id, { quantity: l.quantityPending, lotCode: "", expiresOn: null, supplierLot: "" }]))
    );
  }, [order.data]);

  const o = order.data;
  const pending = o?.lines.filter((l) => l.quantityPending > 0) ?? [];
  const chosen = pending.filter((l) => Number(lines[l.id]?.quantity) > 0);
  const invalid = chosen.some((l) => l.isLotControlled && !/^[A-Za-z0-9._/-]{1,40}$/.test(lines[l.id]?.lotCode ?? ""));

  const save = useMutation({
    mutationFn: () =>
      purchasesApi.receive(orderId!, {
        receptionDate: date,
        deliveryNote: deliveryNote || null,
        notes: notes || null,
        lines: chosen.map((l) => ({
          poLineId: l.id,
          quantity: Number(lines[l.id].quantity),
          lotCode: l.isLotControlled ? lines[l.id].lotCode : undefined,
          expiresOn: l.isLotControlled ? lines[l.id].expiresOn : undefined,
          supplierLot: lines[l.id].supplierLot || undefined
        }))
      }),
    onSuccess: (r) => {
      notifySuccess(`Recepción ${r.number} registrada${r.movementNumber ? ` (${r.movementNumber})` : ""}`);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onDone(r);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar la recepción")
  });

  const set = (id: string, patch: Partial<LineState>) => setLines((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  return (
    <Modal opened={Boolean(orderId)} onClose={onClose} title={o ? `Recibir ${o.number} · ${o.supplierName}` : "Recibir"} size="80rem">
      {!o ? (
        <Text size="sm" c="dimmed">
          Cargando…
        </Text>
      ) : (
        <Stack>
          <Group grow align="flex-start">
            <DateInput label="Fecha de recepción" required valueFormat="DD/MM/YYYY" maxDate={dayjs().format("YYYY-MM-DD")} value={date} onChange={setDate} />
            <TextInput label="Nº nota de entrega del proveedor" value={deliveryNote} onChange={(e) => setDeliveryNote(e.currentTarget.value)} />
            <TextInput label="Almacén" value={o.warehouseCode} readOnly />
          </Group>
          <Alert variant="light" color="petrol" icon={<IconShieldCheck size={18} />}>
            Los lotes entran en <b>cuarentena</b>: no se podrán usar hasta que Calidad los apruebe (y no puede aprobarlos quien los recibe).
          </Alert>
          <Paper withBorder radius="md" className="overflow-x-auto">
            <Table verticalSpacing="xs" miw={980}>
              <Table.Thead className="bg-gray-50">
                <Table.Tr>
                  <Table.Th>Producto</Table.Th>
                  <Table.Th ta="right">Pendiente</Table.Th>
                  <Table.Th w={140}>Recibir</Table.Th>
                  <Table.Th w={160}>Lote</Table.Th>
                  <Table.Th w={150}>Vence</Table.Th>
                  <Table.Th w={140}>Lote proveedor</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {l.productCode}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {l.productName}
                        {l.unitFactor !== 1 ? ` · 1 ${l.unitCode} = ${fmtMoney(l.unitFactor, 0)} ${l.stockUnitCode}` : ""}
                      </Text>
                      {!l.isStockable && (
                        <Badge size="xs" color="gray">
                          Servicio: no genera inventario
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {fmtMoney(l.quantityPending, 2)} {l.unitCode}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput size="xs" min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={lines[l.id]?.quantity ?? ""} onChange={(v) => set(l.id, { quantity: v })} />
                    </Table.Td>
                    <Table.Td>
                      {l.isLotControlled ? (
                        <TextInput size="xs" placeholder="Código" value={lines[l.id]?.lotCode ?? ""} onChange={(e) => set(l.id, { lotCode: e.currentTarget.value })} />
                      ) : (
                        <Text size="xs" c="dimmed">
                          Sin lote
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {l.isLotControlled && (
                        <DateInput
                          size="xs"
                          clearable
                          valueFormat="DD/MM/YYYY"
                          placeholder={l.shelfLifeDays ? `+${l.shelfLifeDays} d` : "—"}
                          value={lines[l.id]?.expiresOn ?? null}
                          onChange={(v) => set(l.id, { expiresOn: v })}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>
                      <TextInput size="xs" value={lines[l.id]?.supplierLot ?? ""} onChange={(e) => set(l.id, { supplierLot: e.currentTarget.value })} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
          <Textarea label="Observaciones" autosize minRows={1} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!date || chosen.length === 0 || invalid}>
              Registrar recepción ({chosen.length} línea{chosen.length === 1 ? "" : "s"})
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
