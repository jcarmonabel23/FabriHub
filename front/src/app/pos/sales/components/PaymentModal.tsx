/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/PaymentModal.tsx
 * @description Cobro: pagos combinados en varias monedas, IGTF, vuelto y autorización del supervisor
 *
 * Cada cambio en los pagos vuelve a cotizar en el servidor (el IGTF depende de lo pagado en divisas).
 * «Exacto» propone lo que falta en la moneda elegida; con IGTF, en divisas se suma el impuesto que ese
 * mismo pago genera (falta / (1 − alícuota)). Solo el efectivo da vuelto.
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Button, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertTriangle, IconCheck, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "@clients/apiClient";
import { fmtMoney } from "@utils/format";
import { notifyError } from "@utils/notify";
import SupervisorFields, { SUPERVISOR_ERRORS, supervisorReady } from "../../components/SupervisorFields";
import { posApi } from "../../services/pos.service";
import { PAYMENT_METHOD_LABEL, type PaymentInput, type PaymentMethod, type PosCurrency, type PosSale, type PosSettings, type QuoteInput, type SupervisorInput } from "../../types";

interface Props {
  opened: boolean;
  onClose: () => void;
  base: QuoteInput;
  currencies: PosCurrency[];
  settings: PosSettings;
  isSupervisor: boolean;
  onSold: (sale: PosSale) => void;
}

const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-6) / 100;

export default function PaymentModal({ opened, onClose, base, currencies, settings, isSupervisor, onSold }: Readonly<Props>) {
  const baseCur = currencies.find((c) => c.isBase) ?? currencies[0];
  const [payments, setPayments] = useState<PaymentInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [currencyId, setCurrencyId] = useState<string>(baseCur?.id ?? "");
  const [amount, setAmount] = useState<number | string>("");
  const [reference, setReference] = useState("");
  const [changeCurrencyId, setChangeCurrencyId] = useState<string>(baseCur?.id ?? "");
  const [supervisor, setSupervisor] = useState<SupervisorInput>({ userId: "", pin: "" });
  const [supError, setSupError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setPayments([]);
    setMethod("cash");
    setCurrencyId(baseCur?.id ?? "");
    setAmount("");
    setReference("");
    setChangeCurrencyId(baseCur?.id ?? "");
    setSupervisor({ userId: "", pin: "" });
    setSupError(null);
  }, [opened, baseCur?.id]);

  const body = useMemo<QuoteInput>(() => ({ ...base, payments, changeCurrencyId }), [base, payments, changeCurrencyId]);
  const [debounced] = useDebouncedValue(body, 150);
  const quote = useQuery({
    queryKey: ["pos", "quote-pay", debounced],
    queryFn: () => posApi.quote(debounced),
    enabled: opened,
    placeholderData: (prev) => prev
  });
  const q = quote.data;
  const cur = currencies.find((c) => c.id === currencyId) ?? baseCur;
  const curOf = (id: string) => currencies.find((c) => c.id === id);

  /** Lo que falta, expresado en la moneda elegida (con el IGTF que ese pago generaría) */
  const exact = useMemo(() => {
    if (!q || !cur || q.pending <= 0) return 0;
    // IGTF = alícuota × min(pagado en divisas, total): mientras lo pagado en divisas no llegue al total,
    // cada bolívar de este pago genera su propio impuesto.
    const r = settings.igtfEnabled && !cur.isBase ? settings.igtfRate / 100 : 0;
    let needBase = q.pending;
    if (r && q.igtf.base < q.total) {
      needBase = q.pending / (1 - r);
      if (q.igtf.base + needBase > q.total) needBase = q.pending + r * (q.total - q.igtf.base);
    }
    return ceil2(needBase / cur.rate);
  }, [q, cur, settings]);

  const needsRef = method !== "cash";
  const amountNum = Number(amount) || 0;
  const canAdd = amountNum > 0 && Boolean(currencyId) && (!needsRef || reference.trim().length > 0);
  const addPayment = (value = amountNum) => {
    if (value <= 0 || (needsRef && !reference.trim())) return;
    setPayments((p) => [...p, { method, currencyId, amount: Math.round(value * 100) / 100, reference: needsRef ? reference.trim() : null }]);
    setAmount("");
    setReference("");
  };

  const needSup = Boolean(q?.needsSupervisor) && !isSupervisor;
  const ready = Boolean(q) && !quote.isFetching && q!.pending <= 0.005 && payments.length > 0 && (!needSup || supervisorReady(supervisor));

  const sell = useMutation({
    mutationFn: () => posApi.sell({ ...base, payments, changeCurrencyId, supervisor: needSup ? supervisor : null }),
    onSuccess: onSold,
    onError: (err) => {
      if (err instanceof ApiError && SUPERVISOR_ERRORS.includes(err.code)) setSupError(err.message);
      else notifyError(err);
    }
  });

  const changeCur = curOf(changeCurrencyId);
  return (
    <Modal opened={opened} onClose={onClose} title="Cobrar" size="xl" closeOnClickOutside={false}>
      <Stack>
        <Group grow align="stretch">
          <Box label="Total a pagar" value={q ? `${baseCur?.code} ${fmtMoney(q.grandTotal)}` : "…"} hint={q?.igtf.amount ? `incluye IGTF ${q.igtf.rate}%: ${fmtMoney(q.igtf.amount)}` : undefined} />
          <Box label="Pagado" value={q ? fmtMoney(q.paid) : "…"} />
          {q && q.change > 0 ? (
            <Box label="Vuelto" value={`${changeCur?.code} ${fmtMoney(q.changeInCurrency)}`} tone="teal" hint={changeCur && !changeCur.isBase ? `= ${fmtMoney(q.change)} ${baseCur?.code}` : undefined} />
          ) : (
            <Box label="Falta" value={q ? fmtMoney(q.pending) : "…"} tone={q && q.pending > 0.005 ? "red" : "teal"} />
          )}
        </Group>

        <Stack gap="xs" className="rounded-lg bg-gray-50 p-3">
          <SegmentedControl
            fullWidth
            value={method}
            onChange={(v) => setMethod(v as PaymentMethod)}
            data={(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
          />
          <Group align="flex-end" wrap="nowrap">
            <Select
              label="Moneda"
              w={130}
              data={currencies.map((c) => ({ value: c.id, label: c.code }))}
              value={currencyId}
              onChange={(v) => v && setCurrencyId(v)}
              allowDeselect={false}
            />
            <NumberInput
              label={cur && !cur.isBase ? `Monto (tasa ${fmtMoney(cur.rate, 4)})` : "Monto"}
              className="flex-1"
              min={0}
              decimalScale={2}
              decimalSeparator=","
              thousandSeparator="."
              data-autofocus
              value={amount}
              onChange={setAmount}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (canAdd) addPayment();
                  else if (ready) sell.mutate();
                }
              }}
            />
            <Button variant="default" disabled={!exact} onClick={() => setAmount(exact)}>
              Exacto{exact ? ` ${fmtMoney(exact)}` : ""}
            </Button>
          </Group>
          {needsRef && (
            <TextInput label="Referencia" placeholder="Nº de aprobación o referencia bancaria" maxLength={60} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
          )}
          <Button leftSection={<IconPlus size={16} />} variant="light" disabled={!canAdd} onClick={() => addPayment()}>
            Agregar pago
          </Button>
        </Stack>

        {payments.length > 0 && (
          <Table fz="sm" withTableBorder>
            <Table.Tbody>
              {payments.map((p, i) => {
                const qp = q?.payments[i];
                return (
                  <Table.Tr key={i}>
                    <Table.Td>{PAYMENT_METHOD_LABEL[p.method]}</Table.Td>
                    <Table.Td>
                      {curOf(p.currencyId)?.code} {fmtMoney(p.amount)}
                    </Table.Td>
                    <Table.Td c="dimmed">{qp && qp.exchangeRate !== 1 ? `= ${fmtMoney(qp.amountBase)} ${baseCur?.code}` : ""}</Table.Td>
                    <Table.Td c="dimmed">{p.reference ? `ref. ${p.reference}` : ""}</Table.Td>
                    <Table.Td w={40}>
                      <ActionIcon variant="subtle" color="red" aria-label="Quitar pago" onClick={() => setPayments(payments.filter((_, j) => j !== i))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}

        {q && q.change > 0 && currencies.length > 1 && (
          <Group>
            <Text size="sm">Entregar el vuelto en</Text>
            <SegmentedControl size="xs" value={changeCurrencyId} onChange={setChangeCurrencyId} data={currencies.map((c) => ({ value: c.id, label: c.code }))} />
          </Group>
        )}
        {quote.error && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {(quote.error as Error).message}
          </Alert>
        )}
        {needSup && (
          <SupervisorFields
            reason={`Hay un descuento mayor a ${q?.maxDiscountPct}%: requiere un supervisor`}
            value={supervisor}
            onChange={(v) => {
              setSupervisor(v);
              setSupError(null);
            }}
            error={supError}
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Volver
          </Button>
          <Button size="md" color="teal" leftSection={<IconCheck size={18} />} disabled={!ready} loading={sell.isPending} onClick={() => sell.mutate()}>
            Confirmar venta
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Box({ label, value, hint, tone }: Readonly<{ label: string; value: string; hint?: string; tone?: "red" | "teal" }>) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xl" fw={800} c={tone}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}
