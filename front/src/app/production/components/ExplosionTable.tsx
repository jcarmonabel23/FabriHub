/**
 * @project FabriHub - Front
 * @file src/app/production/components/ExplosionTable.tsx
 * @description Árbol de explosión de una fórmula con disponible y faltante (Load Explosión + Verificar Existencia)
 */

import { Alert, Badge, Group, Loader, Stack, Table, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { fmtMoney } from "@utils/format";
import { productionApi } from "../services/production.service";

const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);

export default function ExplosionTable({ productId, quantity, formulaId }: Readonly<{ productId: string; quantity: number; formulaId?: string }>) {
  const exp = useQuery({
    queryKey: ["production", "explode", productId, quantity, formulaId],
    queryFn: () => productionApi.explode(productId, quantity, formulaId),
    enabled: quantity > 0
  });
  if (exp.isLoading) return <Loader size="sm" />;
  if (exp.error) return <Alert color="red" variant="light">{(exp.error as Error).message}</Alert>;
  const e = exp.data;
  if (!e) return null;
  return (
    <Stack gap="xs">
      {e.criticalShortages > 0 ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
          Faltan componentes críticos: la orden no se podrá liberar con la existencia actual.
        </Alert>
      ) : e.shortages > 0 ? (
        <Alert color="yellow" variant="light">
          Hay faltantes en componentes no críticos.
        </Alert>
      ) : (
        <Alert color="teal" variant="light">
          Hay existencia disponible para todos los componentes directos.
        </Alert>
      )}
      <Table withTableBorder fz="sm" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Componente</Table.Th>
            <Table.Th ta="right">Requerido</Table.Th>
            <Table.Th ta="right">Disponible</Table.Th>
            <Table.Th ta="right">Faltante</Table.Th>
            <Table.Th ta="right">Costo est.</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {e.items.map((r) => (
            <Table.Tr key={r.path} className={r.level > 1 ? "bg-gray-50" : undefined}>
              <Table.Td style={{ paddingLeft: 8 + (r.level - 1) * 22 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={r.level === 1 ? 600 : 400}>
                    {r.componentCode}
                  </Text>
                  {r.isCritical && <Badge size="xs" color="red" variant="light">Crítico</Badge>}
                  {r.hasFormula && <Badge size="xs" color="violet" variant="light">Fabricado</Badge>}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {r.componentName}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                {qty(r.quantity)} {r.unitCode}
              </Table.Td>
              <Table.Td ta="right">{qty(r.available)}</Table.Td>
              <Table.Td ta="right">
                <Text size="sm" fw={r.shortfall > 0 ? 700 : 400} c={r.shortfall > 0 ? (r.isCritical ? "red" : "orange") : "teal"}>
                  {r.shortfall > 0 ? qty(r.shortfall) : "—"}
                </Text>
              </Table.Td>
              <Table.Td ta="right">{r.level === 1 ? fmtMoney(r.quantity * r.stdCost) : ""}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm" ta="right" fw={700}>
        Materiales a costo estándar: {fmtMoney(e.materialCost)}
      </Text>
      <Text size="xs" c="dimmed">
        Los niveles inferiores (sombreados) muestran lo que costaría fabricar el semielaborado completo; el faltante neto lo calcula el MRP.
      </Text>
    </Stack>
  );
}

