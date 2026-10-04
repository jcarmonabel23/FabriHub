/**
 * @project FabriHub - Front
 * @file src/app/sales/delivery-notes/DeliverModal.tsx
 * @description Despachar una orden de venta: cantidades por línea y lotes (FEFO automático o elegidos a mano)
 */

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Stack, Switch, Table, Text, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconAlertCircle, IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ApiError } from "@clients/apiClient";
import { fmtMoney } from "@utils/format";
import { notifySuccess } from "@utils/notify";
import { salesApi } from "../services/sales.service";
import type { DeliveryDetail } from "../types";

const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);

interface LineState {
  quantity: number | string;
  manual: boolean;
  lots: Record<string, number | string>;
}

export default function DeliverModal({ orderId, onClose, onDone }: Readonly<{ orderId: string | null; onClose: () => void; onDone: (d: DeliveryDetail) => void }>) {
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ["sales", "delivery-order", orderId], queryFn: () => salesApi.orderForDelivery(orderId!), enabled: Boolean(orderId) });
  const [date, setDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [carrier, setCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [error, setError] = useState<string | null>(null);

  const o = order.data;
  useEffect(() => {
    if (!o) return;
    setError(null);
    setCarrier("");
    setNotes("");
    // Por defecto se propone despachar lo reservado (lo que hay); el resto queda pendiente.
    setLines(
      Object.fromEntries(
        o.lines
          .filter((l) => l.quantityPending > 0)
          .map((l) => [l.id, { quantity: l.isStockable ? Math.min(l.quantityPending, Math.max(l.quantityReserved, 0)) : l.quantityPending, manual: false, lots: {} }])
      )
    );
  }, [o]);

  const pending = o?.lines.filter((l) => l.quantityPending > 0) ?? [];
  const chosen = pending.filter((l) => Number(lines[l.id]?.quantity) > 0);
  const lotsOf = (lineId: string) => o?.lots.filter((x) => x.soLineId === lineId) ?? [];
  const manualSum = (lineId: string) => Object.values(lines[lineId]?.lots ?? {}).reduce<number>((a, v) => a + (Number(v) || 0), 0);
  const invalid = chosen.some((l) => lines[l.id].manual && Math.abs(manualSum(l.id) - Number(lines[l.id].quantity)) > 1e-6);

  const save = useMutation({
    mutationFn: () =>
      salesApi.deliver(orderId!, {
        deliveryDate: date,
        carrier: carrier || null,
        notes: notes || null,
        lines: chosen.map((l) => ({
          soLineId: l.id,
          quantity: Number(lines[l.id].quantity),
          lots: lines[l.id].manual
            ? Object.entries(lines[l.id].lots)
                .filter(([, v]) => Number(v) > 0)
                .map(([lotId, v]) => ({ lotId: lotId === "none" ? null : lotId, quantity: Number(v) }))
            : undefined
        }))
      }),
    onSuccess: (d) => {
      notifySuccess(`Nota ${d.number} registrada${d.movementNumber ? ` (${d.movementNumber})` : ""}`);
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onDone(d);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar el despacho")
  });
  const set = (id: string, patch: Partial<LineState>) => setLines((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  return (
    <Modal opened={Boolean(orderId)} onClose={onClose} title={o ? `Despachar ${o.number} · ${o.customerName}` : "Despachar"} size="80rem">
      {!o ? (
        <Text size="sm" c="dimmed">Cargando…</Text>
      ) : (
        <Stack>
          <Group grow align="flex-start">
            <DateInput label="Fecha de despacho" required valueFormat="DD/MM/YYYY" maxDate={dayjs().format("YYYY-MM-DD")} value={date} onChange={setDate} />
            <TextInput label="Transportista / chofer" value={carrier} onChange={(e) => setCarrier(e.currentTarget.value)} />
            <TextInput label="Almacén" value={o.warehouseCode} readOnly />
          </Group>
          <Alert variant="light" color="petrol" icon={<IconInfoCircle size={18} />}>
            Automático: sale primero lo reservado y luego lo libre, siempre el lote que vence antes (FEFO). Si elige lotes a mano, la regla FEFO se valida igual.
          </Alert>
          <Paper withBorder radius="md" className="overflow-x-auto">
            <Table verticalSpacing="xs" miw={980}>
              <Table.Thead className="bg-gray-50">
                <Table.Tr>
                  <Table.Th>Producto</Table.Th>
                  <Table.Th ta="right">Pendiente</Table.Th>
                  <Table.Th ta="right">Reservado</Table.Th>
                  <Table.Th w={150}>Despachar</Table.Th>
                  <Table.Th w={380}>Lotes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((l) => {
                  const st = lines[l.id];
                  const lots = lotsOf(l.id);
                  return (
                    <Table.Tr key={l.id}>
                      <Table.Td>
                        <Text size="sm" fw={600}>{l.productCode}</Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>{l.productName}</Text>
                      </Table.Td>
                      <Table.Td ta="right">{qty(l.quantityPending)} {l.unitCode}</Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" c={l.quantityReserved < l.quantityPending ? "orange" : undefined}>{qty(l.quantityReserved)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" min={0} max={l.quantityPending} decimalScale={4} decimalSeparator="," thousandSeparator="." value={st?.quantity ?? ""} onChange={(v) => set(l.id, { quantity: v })} />
                      </Table.Td>
                      <Table.Td>
                        {!l.isStockable ? (
                          <Badge size="xs" color="gray">Servicio</Badge>
                        ) : (
                          <Stack gap={4}>
                            <Switch size="xs" label="Elegir lotes a mano" checked={st?.manual ?? false} onChange={(e) => set(l.id, { manual: e.currentTarget.checked, lots: {} })} />
                            {st?.manual &&
                              lots.map((x) => (
                                <Group key={x.lotId ?? "none"} gap={6} wrap="nowrap">
                                  <Text size="xs" w={150}>
                                    {x.lotCode ?? "Sin lote"} · {x.expiresOn ? dayjs(x.expiresOn).format("DD/MM/YY") : "—"} · {qty(x.capacity / l.unitFactor)}
                                  </Text>
                                  <NumberInput size="xs" w={110} min={0} max={x.capacity / l.unitFactor} decimalScale={4} decimalSeparator="," value={st.lots[x.lotId ?? "none"] ?? ""} onChange={(v) => set(l.id, { lots: { ...st.lots, [x.lotId ?? "none"]: v } })} />
                                </Group>
                              ))}
                            {st?.manual && Math.abs(manualSum(l.id) - Number(st.quantity)) > 1e-6 && (
                              <Text size="xs" c="red">Los lotes suman {qty(manualSum(l.id))}; deben sumar {qty(Number(st.quantity) || 0)}</Text>
                            )}
                          </Stack>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
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
            <Button variant="default" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!date || chosen.length === 0 || invalid}>
              Registrar nota de entrega ({chosen.length} línea{chosen.length === 1 ? "" : "s"})
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
