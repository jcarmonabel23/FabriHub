/**
 * @project FabriHub - Front
 * @file src/app/taxes/withholdings/BracketsEditor.tsx
 * @description Editor de tramos (tesis: Monto Base, Sustraendo y Tarifa 1 al 4 → N tramos)
 */

import { ActionIcon, Button, Group, NumberInput, Stack, Table, Text } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { Bracket } from "../types";

interface Props {
  value: Bracket[];
  onChange: (b: Bracket[]) => void;
}

export function bracketsError(b: Bracket[]): string | null {
  if (b.length === 0) return "Defina al menos un tramo";
  if (new Set(b.map((x) => x.fromAmount)).size !== b.length) return "Dos tramos no pueden empezar en el mismo monto";
  if (b.some((x) => x.rate < 0 || x.rate > 100)) return "El porcentaje va de 0 a 100";
  return null;
}

export default function BracketsEditor({ value, onChange }: Readonly<Props>) {
  const set = (i: number, patch: Partial<Bracket>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const add = () => {
    const last = value.at(-1);
    onChange([...value, { fromAmount: last ? last.fromAmount + 1000 : 0, rate: last?.rate ?? 0, subtrahend: 0 }]);
  };
  const error = bracketsError(value);
  const num = (v: string | number) => (typeof v === "number" ? v : 0);

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        Tramos
      </Text>
      <Text size="xs" c="dimmed">
        Se aplica el tramo de mayor «desde» que no supere la base. Retención = base × % − sustraendo (nunca negativa).
        Si el primer tramo no empieza en 0, por debajo de él no se retiene (monto mínimo).
      </Text>
      <Table withTableBorder fz="sm" verticalSpacing={4}>
        <Table.Thead className="bg-gray-50">
          <Table.Tr>
            <Table.Th>Desde (monto base)</Table.Th>
            <Table.Th>%</Table.Th>
            <Table.Th>Sustraendo</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {value.map((b, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <NumberInput size="xs" min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," value={b.fromAmount} onChange={(v) => set(i, { fromAmount: num(v) })} aria-label="Desde" />
              </Table.Td>
              <Table.Td w={110}>
                <NumberInput size="xs" min={0} max={100} decimalScale={4} decimalSeparator="," value={b.rate} onChange={(v) => set(i, { rate: num(v) })} aria-label="Porcentaje" />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" min={0} decimalScale={2} thousandSeparator="." decimalSeparator="," value={b.subtrahend} onChange={(v) => set(i, { subtrahend: num(v) })} aria-label="Sustraendo" />
              </Table.Td>
              <Table.Td w={40}>
                <ActionIcon size="sm" variant="subtle" color="red" aria-label="Quitar tramo" disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={add} disabled={value.length >= 20}>
          Agregar tramo
        </Button>
        {error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
