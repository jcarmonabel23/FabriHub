/**
 * @project FabriHub - Front
 * @file src/app/dashboard/components/DashboardRates.tsx
 * @description Tarjeta lateral del tablero: tipo de cambio oficial del dólar y del euro en la moneda local
 *
 * Venezuela: tasa del BCV en bolívares; Costa Rica: tipo de cambio de referencia del BCCR en colones.
 * Si falta la del día, la API pide la consulta en segundo plano y aquí se vuelve a preguntar.
 */

import { Badge, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowsExchange } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import CurrencyFlag from "@atoms/currency/CurrencyFlag";
import { fmtMoney, fmtRelative } from "@utils/format";
import { dashboardApi } from "../dashboard.service";

export default function DashboardRates() {
  const rates = useQuery({
    queryKey: ["dashboard", "exchange-rates"],
    queryFn: dashboardApi.exchangeRates,
    refetchInterval: (q) => (q.state.data?.refreshing ? 15_000 : 15 * 60_000)
  });
  const d = rates.data;
  const local = d?.local;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <Group gap="xs" mb="md" wrap="nowrap">
        <IconArrowsExchange size={20} className="text-brand-700" />
        <Text fw={700}>Tipo de cambio oficial</Text>
        {d?.refreshing && <Loader size={14} />}
      </Group>

      {rates.isLoading && <Loader size="sm" />}
      {rates.isError && (
        <Text size="sm" c="dimmed">
          No se pudo consultar el tipo de cambio.
        </Text>
      )}

      {d && (
        <Stack gap="sm">
          {d.rates.map((r) => (
            <div key={r.code} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2">
              <CurrencyFlag code={r.code} size={32} />
              <div className="min-w-0 flex-1">
                <Text size="xs" c="dimmed">
                  1 {r.code} ({r.name})
                </Text>
                <Text fw={800} ff="monospace" size="lg">
                  {r.rate === null ? "Sin tasa" : `${local?.code} ${fmtMoney(r.rate, 4)}`}
                </Text>
                {r.rateDate && (
                  <Text size="xs" c="dimmed">
                    Vigente desde {dayjs(r.rateDate).format("DD/MM/YYYY")}
                    {!r.official && (
                      <Badge ml={6} size="xs" color="gray" variant="light">
                        manual
                      </Badge>
                    )}
                  </Text>
                )}
                {r.next?.rate != null && (
                  <Text size="xs" c="teal">
                    Desde el {dayjs(r.next.rateDate).format("DD/MM")}: {local?.code} {fmtMoney(r.next.rate, 4)}
                  </Text>
                )}
              </div>
            </div>
          ))}
          <Text size="xs" c="dimmed">
            {d.provider ? `Fuente: ${d.provider.name}` : "Este país no tiene fuente automática: tasas cargadas a mano"}
            {d.lastRun?.finishedAt && (
              <>
                {" · "}
                <Tooltip label={d.lastRun.message ?? "Consulta correcta"} disabled={d.lastRun.status === "ok"} multiline w={260}>
                  <Text span size="xs" c={d.lastRun.status === "error" ? "red" : "dimmed"}>
                    consultado {fmtRelative(d.lastRun.finishedAt)}
                    {d.lastRun.status === "error" ? " (falló)" : ""}
                  </Text>
                </Tooltip>
              </>
            )}
          </Text>
        </Stack>
      )}
    </div>
  );
}
