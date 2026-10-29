/**
 * @project FabriHub - Front
 * @file src/app/pos/components\CloseSessionModal.tsx
 * @description Cierre de turno con arqueo: lo esperado por medio de pago y moneda contra lo contado
 *
 * El efectivo debe contarse. Los medios electrónicos vienen con lo esperado (se ajustan si el
 * cierre del banco difiere). Con diferencia, el servidor puede exigir una observación.
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, NumberInput, Table, Text, Textarea } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "@atoms/forms/FormModal";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { posApi } from "../services/pos.service";
import { PAYMENT_METHOD_LABEL, type PosSessionDetail } from "../types";

interface Props {
  sessionId: string | null;
  onClose: () => void;
  onClosed?: (s: PosSessionDetail) => void;
}

export default function CloseSessionModal({ sessionId, onClose, onClosed }: Readonly<Props>) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["pos", "session", sessionId], queryFn: () => posApi.getSession(sessionId!), enabled: Boolean(sessionId) });
  const [counted, setCounted] = useState<Record<string, number | string>>({});
  const [notes, setNotes] = useState("");
  const key = (method: string, currencyId: string) => `${method}:${currencyId}`;

  useEffect(() => {
    if (!detail.data) return;
    // El efectivo se cuenta desde cero; lo electrónico parte de lo esperado
    setCounted(Object.fromEntries(detail.data.counts.map((c) => [key(c.method, c.currencyId), c.method === "cash" ? "" : c.expected])));
    setNotes("");
  }, [detail.data]);

  const rows = useMemo(
    () =>
      (detail.data?.counts ?? []).map((c) => {
        const v = counted[key(c.method, c.currencyId)];
        const amount = v === "" || v === undefined ? null : Number(v);
        return { ...c, amount, diff: amount === null ? null : Math.round((amount - c.expected) * 100) / 100 };
      }),
    [detail.data, counted]
  );
  const missingCash = rows.some((r) => r.method === "cash" && r.amount === null);
  const withDiff = rows.some((r) => r.diff !== null && Math.abs(r.diff) >= 0.005);

  const close = useMutation({
    mutationFn: () =>
      posApi.closeSession(sessionId!, {
        counts: rows.filter((r) => r.amount !== null).map((r) => ({ method: r.method, currencyId: r.currencyId, amount: r.amount! })),
        notes: notes.trim() || null
      }),
    onSuccess: (s) => {
      notifySuccess(`Turno ${s.number} cerrado`);
      qc.invalidateQueries({ queryKey: ["pos"] });
      onClosed?.(s);
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  return (
    <FormModal
      opened={Boolean(sessionId)}
      onClose={onClose}
      title={`Cerrar turno ${detail.data?.number ?? ""}`}
      onSubmit={() => close.mutate()}
      loading={close.isPending}
      valid={Boolean(detail.data) && !missingCash}
      size="xl"
      submitLabel="Cerrar turno"
    >
      {detail.data && (
        <Text size="sm" c="dimmed">
          Caja {detail.data.terminalCode} · {detail.data.totals.completed} venta(s) por {fmtMoney(detail.data.totals.grandTotal)}
          {detail.data.totals.voided ? ` · ${detail.data.totals.voided} anulada(s)` : ""}
        </Text>
      )}
      <Table withTableBorder fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Medio</Table.Th>
            <Table.Th ta="right">Fondo</Table.Th>
            <Table.Th ta="right">Cobrado</Table.Th>
            <Table.Th ta="right">Vuelto</Table.Th>
            <Table.Th ta="right">Esperado</Table.Th>
            <Table.Th w={150}>Contado</Table.Th>
            <Table.Th ta="right">Diferencia</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={key(r.method, r.currencyId)}>
              <Table.Td>
                {PAYMENT_METHOD_LABEL[r.method]} · {r.currencyCode}
              </Table.Td>
              <Table.Td ta="right">{fmtMoney(r.opening)}</Table.Td>
              <Table.Td ta="right">{fmtMoney(r.received)}</Table.Td>
              <Table.Td ta="right">{r.change ? `-${fmtMoney(r.change)}` : "—"}</Table.Td>
              <Table.Td ta="right" fw={600}>
                {fmtMoney(r.expected)}
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  min={0}
                  decimalScale={2}
                  decimalSeparator=","
                  thousandSeparator="."
                  placeholder={r.method === "cash" ? "Cuente" : undefined}
                  value={counted[key(r.method, r.currencyId)] ?? ""}
                  onChange={(v) => setCounted({ ...counted, [key(r.method, r.currencyId)]: v })}
                />
              </Table.Td>
              <Table.Td ta="right" c={r.diff === null || Math.abs(r.diff) < 0.005 ? undefined : r.diff < 0 ? "red" : "teal"} fw={600}>
                {r.diff === null ? "—" : fmtMoney(r.diff)}
              </Table.Td>
            </Table.Tr>
          ))}
          {!rows.length && (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text size="sm" c="dimmed" ta="center">
                  Sin fondo ni cobros en este turno
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {withDiff && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />}>
          El arqueo no cuadra. Explique la diferencia en la observación.
        </Alert>
      )}
      <Textarea label="Observación" autosize minRows={2} maxLength={800} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
    </FormModal>
  );
}
