/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/components/RatesDrawer.tsx
 * @description Tasas de cambio de una moneda: registro diario e histórico
 */

import { useState } from "react";
import { ActionIcon, Alert, Button, Drawer, Group, NumberInput, Stack, Table, Text, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconInfoCircle, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "../../services/settings.service";
import type { CatalogItem } from "../../types";

export default function RatesDrawer({ currency, baseCode, onClose }: Readonly<{ currency: CatalogItem | null; baseCode: string; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan("SET_COMMERCIAL");
  const [date, setDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [rate, setRate] = useState<number | string>("");
  const [source, setSource] = useState("BCV");

  const isBase = currency?.code === baseCode;
  const rates = useQuery({
    queryKey: ["settings", "rates", currency?.id],
    queryFn: () => settingsApi.listRates(currency!.id),
    enabled: Boolean(currency) && !isBase
  });

  const save = useMutation({
    mutationFn: () => settingsApi.upsertRate(currency!.id, { rateDate: date!, rate: Number(rate), source: source || undefined }),
    onSuccess: () => {
      notifySuccess("Tasa registrada");
      setRate("");
      qc.invalidateQueries({ queryKey: ["settings", "rates", currency?.id] });
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (id: string) => settingsApi.deleteRate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "rates", currency?.id] }),
    onError: (err) => notifyError(err)
  });

  return (
    <Drawer opened={Boolean(currency)} onClose={onClose} position="right" size="md" title={`Tasas de cambio · ${currency?.code ?? ""}`}>
      {isBase ? (
        <Alert icon={<IconInfoCircle size={18} />} color="petrol" variant="light">
          {currency?.code} es la moneda base de la empresa: siempre vale 1 y no lleva tasa.
        </Alert>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            Bolívares ({baseCode}) por 1 {currency?.code}. Se registra una tasa por día; registrar de nuevo el mismo día la corrige.
          </Text>
          {can("edit") && (
            <Group align="flex-end" grow>
              <DateInput label="Fecha" value={date} onChange={setDate} maxDate={dayjs().format("YYYY-MM-DD")} valueFormat="DD/MM/YYYY" />
              <NumberInput label="Tasa" min={0} decimalScale={8} decimalSeparator="," thousandSeparator="." value={rate} onChange={setRate} />
              <TextInput label="Fuente" value={source} onChange={(e) => setSource(e.currentTarget.value)} />
            </Group>
          )}
          {can("edit") && (
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!date || !(Number(rate) > 0)}>
              Registrar tasa
            </Button>
          )}
          <Table striped withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th ta="right">Tasa</Table.Th>
                <Table.Th>Fuente</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(rates.data ?? []).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="sm">{dayjs(r.rateDate).format("DD/MM/YYYY")}</Text>
                    <Text size="xs" c="dimmed">
                      {r.createdBy ?? "—"} · {fmtDateTime(r.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {fmtMoney(r.rate, 4)}
                  </Table.Td>
                  <Table.Td>{r.source ?? "—"}</Table.Td>
                  <Table.Td>
                    {can("delete") && (
                      <ActionIcon variant="subtle" color="red" aria-label="Eliminar tasa" onClick={() => remove.mutate(r.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rates.data?.length === 0 && (
            <Text size="sm" c="dimmed" ta="center">
              Sin tasas registradas.
            </Text>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
