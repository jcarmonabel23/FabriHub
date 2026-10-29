/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/OpenSessionPanel.tsx
 * @description Apertura de turno: elegir una caja libre y declarar el fondo en efectivo por moneda
 */

import { useState } from "react";
import { Alert, Badge, Button, Card, Group, NumberInput, Paper, SimpleGrid, Stack, Text, Textarea, Title, UnstyledButton } from "@mantine/core";
import { IconCashRegister, IconInfoCircle, IconLock } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { notifyError, notifySuccess } from "@utils/notify";
import { posApi } from "../../services/pos.service";
import type { PosMe } from "../../types";

interface Props {
  me: PosMe;
  canOpen: boolean;
}

export default function OpenSessionPanel({ me, canOpen }: Readonly<Props>) {
  const qc = useQueryClient();
  const free = me.terminals.filter((t) => !t.isBusy);
  const [terminalId, setTerminalId] = useState<string | null>(free.length === 1 ? free[0].id : null);
  const [float, setFloat] = useState<Record<string, number | string>>({});
  const [notes, setNotes] = useState("");

  const open = useMutation({
    mutationFn: () =>
      posApi.openSession({
        terminalId: terminalId!,
        openingFloat: me.currencies.map((c) => ({ currencyId: c.id, amount: Number(float[c.id]) || 0 })).filter((f) => f.amount > 0),
        notes: notes.trim() || null
      }),
    onSuccess: (s) => {
      notifySuccess(`Turno ${s.number} abierto en la caja ${s.terminalCode}`);
      qc.invalidateQueries({ queryKey: ["pos", "me"] });
    },
    onError: (err) => notifyError(err)
  });

  return (
    <Paper withBorder radius="lg" p="xl" maw={860} mx="auto" mt="md">
      <Stack>
        <Group gap="sm">
          <IconCashRegister size={32} className="text-[var(--mantine-color-petrol-6,#167c94)]" />
          <div>
            <Title order={3}>Abrir turno</Title>
            <Text size="sm" c="dimmed">
              Elija la caja y cuente el fondo con que empieza. Solo usted venderá en este turno.
            </Text>
          </div>
        </Group>

        {!canOpen && (
          <Alert color="orange" variant="light" icon={<IconLock size={18} />}>
            No tiene permiso para abrir turnos (Turnos de caja → Agregar). Pida a un supervisor que se lo asigne.
          </Alert>
        )}
        {!me.terminals.length && (
          <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
            No hay cajas activas. Créelas en <Link to="/pos/terminals">Punto de venta → Cajas</Link>.
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {me.terminals.map((t) => (
            <UnstyledButton key={t.id} disabled={t.isBusy} onClick={() => setTerminalId(t.id)}>
              <Card withBorder radius="md" className={`${terminalId === t.id ? "ring-2 ring-[var(--mantine-color-petrol-5,#167c94)]" : ""} ${t.isBusy ? "opacity-50" : ""}`}>
                <Group justify="space-between">
                  <Text fw={700}>{t.code}</Text>
                  {t.isBusy && <Badge color="gray">Ocupada</Badge>}
                </Group>
                <Text size="sm">{t.name}</Text>
                <Text size="xs" c="dimmed">
                  Almacén {t.warehouseCode} · {t.priceListName ?? "precio de referencia"}
                </Text>
              </Card>
            </UnstyledButton>
          ))}
        </SimpleGrid>

        <Text fw={600} size="sm">
          Fondo de caja (efectivo)
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {me.currencies.map((c) => (
            <NumberInput
              key={c.id}
              label={c.code}
              min={0}
              decimalScale={2}
              decimalSeparator=","
              thousandSeparator="."
              placeholder="0,00"
              value={float[c.id] ?? ""}
              onChange={(v) => setFloat({ ...float, [c.id]: v })}
            />
          ))}
        </SimpleGrid>
        <Textarea label="Observación" autosize minRows={1} maxLength={400} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button size="md" disabled={!canOpen || !terminalId} loading={open.isPending} onClick={() => open.mutate()}>
            Abrir turno
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
