/**
 * @project FabriHub - Front
 * @file src/app/dashboard/indicators/Page.tsx
 * @description Tablero → Indicadores (DSH_INDICATORS): KPIs y tendencias por subsistema
 *
 * Cada bloque aparece solo si la API lo envió, es decir, si el usuario puede ver su módulo de origen.
 */

import type { ReactNode } from "react";
import { Alert, Badge, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { BarChart, DonutChart } from "@mantine/charts";
import {
  IconAlertTriangle,
  IconCalendarExclamation,
  IconCalendarStats,
  IconCash,
  IconClipboardList,
  IconClockExclamation,
  IconFileInvoice,
  IconFlask,
  IconGauge,
  IconPackages,
  IconPercentage,
  IconReceipt,
  IconRefresh,
  IconRosetteDiscountCheck,
  IconScale,
  IconShoppingCart,
  IconTruckDelivery
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { fmtDateTime, fmtMoney } from "@utils/format";
import KpiCard from "../atoms/KpiCard";
import { DASHBOARD_ACTIONS } from "../dashboardActions";
import { dashboardApi } from "../dashboard.service";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planificadas",
  created: "Creadas",
  released: "Liberadas",
  in_process: "En proceso",
  confirmed: "Confirmadas"
};

const month = (m: string) => dayjs(`${m}-01`).format("MMM YY");
const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${fmtMoney(v * 100, digits)} %`);
const int = (v: number) => fmtMoney(v, 0);
const compact = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle?: string; children: ReactNode }>) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" mb="md" align="flex-end">
        <div>
          <Title order={4}>{title}</Title>
          {subtitle && (
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
      </Group>
      <Stack gap="lg">{children}</Stack>
    </Paper>
  );
}

function RankTable({ rows, label, money }: Readonly<{ rows: { name: string; value: number }[]; label: string; money: string }>) {
  if (rows.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Sin movimientos en el período.
      </Text>
    );
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Table verticalSpacing={6} withRowBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th className="text-xs text-gray-500">{label}</Table.Th>
          <Table.Th className="text-xs text-gray-500 text-right">Monto ({money})</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.name}>
            <Table.Td>
              <Text size="sm" lineClamp={1}>
                {r.name}
              </Text>
              <div className="h-1.5 rounded-full bg-brand-100 mt-1">
                <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </Table.Td>
            <Table.Td className="text-right">
              <Text size="sm" fw={600}>
                {fmtMoney(r.value)}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export default function IndicatorsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["dashboard", "indicators"], queryFn: dashboardApi.indicators, refetchInterval: 5 * 60_000 });
  const d = q.data;
  const cur = d?.currency.code ?? "";
  const empty = d && !d.inventory && !d.quality && !d.production && !d.purchases && !d.sales && !d.planning;

  return (
    <div className="p-6">
      <ModuleHeader title="Indicadores" description="Cómo va la planta: inventario, calidad, producción, compras y ventas." actions={DASHBOARD_ACTIONS} />

      {q.isLoading && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}
      {d && (
        <Group gap="xs" mb="md">
          <IconRefresh size={14} className="text-gray-400" />
          <Text size="xs" c="dimmed">
            Calculado {fmtDateTime(d.generatedAt)} · montos en {cur} (moneda base) · se actualiza cada 5 minutos
          </Text>
        </Group>
      )}
      {empty && (
        <Alert color="gray" variant="light">
          No tiene acceso de consulta a ningún módulo con indicadores (Existencias, Calidad, Órdenes de producción, compra o venta,
          Planificación).
        </Alert>
      )}

      <Stack gap="lg">
        {d?.inventory && (
          <Section
            title="Inventario"
            subtitle={d.inventory.restricted ? "Solo sus almacenes asignados" : "Todos los almacenes"}
          >
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 6 }}>
              <KpiCard label="Valor del inventario" value={`${fmtMoney(d.inventory.totalValue)} ${cur}`} hint={`${d.inventory.productsWithStock} productos con existencia`} icon={IconCash} onClick={() => navigate("/inventory/stock")} />
              <KpiCard
                label="Cobertura"
                value={d.inventory.coverageDays === null ? "—" : `${int(d.inventory.coverageDays)} días`}
                help="Valor del inventario ÷ costo promedio diario de las salidas de los últimos 90 días."
                icon={IconGauge}
              />
              <KpiCard
                label="Rotación anual"
                value={d.inventory.turnover === null ? "—" : `${fmtMoney(d.inventory.turnover, 1)} veces`}
                help="Costo de las salidas de 90 días llevado a un año ÷ valor actual del inventario."
                icon={IconRefresh}
              />
              <KpiCard label="Bajo el mínimo" value={int(d.inventory.belowMin)} hint="productos por almacén" icon={IconAlertTriangle} color={d.inventory.belowMin ? "orange" : "teal"} onClick={() => navigate("/inventory/stock")} />
              <KpiCard label="Lotes por vencer" value={int(d.inventory.expiringLots)} hint={`${d.inventory.expiredLots} vencidos con existencia`} icon={IconCalendarExclamation} color={d.inventory.expiredLots ? "red" : d.inventory.expiringLots ? "orange" : "teal"} onClick={() => navigate("/inventory/lots")} />
              <KpiCard label="En cuarentena" value={int(d.inventory.quarantineLots)} hint="lotes con existencia" icon={IconFlask} color="grape" />
            </SimpleGrid>
            {d.inventory.valueByType.length > 0 && (
              <Group align="center" gap="xl" wrap="wrap">
                <DonutChart
                  size={180}
                  thickness={28}
                  withTooltip
                  tooltipDataSource="segment"
                  valueFormatter={(v) => `${fmtMoney(v)} ${cur}`}
                  data={d.inventory.valueByType.map((t, i) => ({
                    name: t.type,
                    value: t.value,
                    color: ["petrol.6", "teal.5", "orange.5", "grape.5", "gray.5", "blue.5"][i % 6]
                  }))}
                  chartLabel={compact.format(d.inventory.totalValue)}
                />
                <Stack gap={6}>
                  <Text size="sm" fw={600}>
                    Valor por tipo de producto
                  </Text>
                  {d.inventory.valueByType.map((t, i) => (
                    <Group key={t.type} gap="xs">
                      <span className="h-3 w-3 rounded-sm" style={{ background: `var(--mantine-color-${["petrol-6", "teal-5", "orange-5", "grape-5", "gray-5", "blue-5"][i % 6]})` }} />
                      <Text size="sm">{t.type}</Text>
                      <Text size="sm" c="dimmed">
                        {fmtMoney(t.value)} {cur} · {pct(d.inventory!.totalValue ? t.value / d.inventory!.totalValue : null)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Group>
            )}
          </Section>
        )}

        {d?.production && (
          <Section title="Producción" subtitle="Órdenes abiertas, cumplimiento y costo (180 días)">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <KpiCard label="OP abiertas" value={int(d.production.open)} hint={d.production.byStatus.map((s) => `${s.count} ${STATUS_LABEL[s.status]?.toLowerCase() ?? s.status}`).join(" · ") || "—"} icon={IconClipboardList} onClick={() => navigate("/production/orders")} />
              <KpiCard label="OP atrasadas" value={int(d.production.late)} hint="pasada su fecha de fin" icon={IconClockExclamation} color={d.production.late ? "red" : "teal"} onClick={() => navigate("/production/orders")} />
              <KpiCard label="Terminadas a tiempo" value={pct(d.production.onTimeRate)} help="OP confirmadas en 180 días cuya fecha de confirmación no pasó su fin planificado." icon={IconRosetteDiscountCheck} />
              <KpiCard
                label="Variación de costo"
                value={d.production.variancePct === null ? "—" : `${d.production.variancePct > 0 ? "+" : ""}${pct(d.production.variancePct, 1)}`}
                help="(Costo real − estándar de lo fabricado) ÷ estándar, OP cerradas en 180 días. Positivo = desfavorable."
                icon={IconScale}
                color={d.production.variancePct !== null && d.production.variancePct > 0.05 ? "orange" : "teal"}
              />
            </SimpleGrid>
            <div>
              <Text size="sm" fw={600} mb="xs">
                Cantidad fabricada por mes
              </Text>
              <BarChart
                h={220}
                data={d.production.monthly.map((m) => ({ ...m, label: month(m.month) }))}
                dataKey="label"
                series={[{ name: "produced", label: "Unidades confirmadas", color: "petrol.6" }]}
                valueFormatter={(v) => fmtMoney(v, 0)}
                tickLine="y"
              />
            </div>
          </Section>
        )}

        {d?.sales && (
          <Section title="Ventas" subtitle={d.sales.restricted ? "Solo sus órdenes" : "Todas las órdenes"}>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <KpiCard label="OV abiertas" value={int(d.sales.open)} hint={`${fmtMoney(d.sales.openAmount)} ${cur} por despachar`} icon={IconReceipt} onClick={() => navigate("/sales/orders")} />
              <KpiCard label="OV atrasadas" value={int(d.sales.late)} hint="pasada la fecha pedida" icon={IconClockExclamation} color={d.sales.late ? "red" : "teal"} onClick={() => navigate("/sales/orders")} />
              <KpiCard label="Líneas pendientes" value={int(d.sales.backorderLines)} hint="por falta de existencia o por despachar" icon={IconPackages} color={d.sales.backorderLines ? "orange" : "teal"} />
              <KpiCard label="Entregas a tiempo" value={pct(d.sales.onTimeRate)} help="OV despachadas por completo (180 días) cuya última nota de entrega no pasó la fecha pedida." icon={IconTruckDelivery} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, lg: 3 }}>
              <div className="lg:col-span-2">
                <Text size="sm" fw={600} mb="xs">
                  Venta, costo y margen por mes ({cur})
                </Text>
                <BarChart
                  h={240}
                  data={d.sales.monthly.map((m) => ({ ...m, label: month(m.month) }))}
                  dataKey="label"
                  series={[
                    { name: "sales", label: "Venta neta", color: "petrol.6" },
                    { name: "cost", label: "Costo", color: "gray.5" },
                    { name: "margin", label: "Margen", color: "teal.5" }
                  ]}
                  valueFormatter={(v) => fmtMoney(v)}
                  withLegend
                  tickLine="y"
                />
              </div>
              <div>
                <Text size="sm" fw={600} mb="xs">
                  Productos más vendidos (90 días)
                </Text>
                <RankTable rows={d.sales.topProducts.map((p) => ({ name: `${p.code} · ${p.name}`, value: p.amount }))} label="Producto" money={cur} />
              </div>
            </SimpleGrid>
          </Section>
        )}

        {d?.purchases && (
          <Section title="Compras" subtitle="Órdenes de compra y cumplimiento de proveedores (180 días)">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <KpiCard label="OC abiertas" value={int(d.purchases.open)} hint={`${fmtMoney(d.purchases.openAmount)} ${cur} · ${d.purchases.pendingApproval} por aprobar`} icon={IconFileInvoice} onClick={() => navigate("/purchases/orders")} />
              <KpiCard label="OC atrasadas" value={int(d.purchases.overdue)} hint="pasada la fecha esperada" icon={IconClockExclamation} color={d.purchases.overdue ? "red" : "teal"} onClick={() => navigate("/purchases/orders")} />
              <KpiCard label="Proveedores a tiempo" value={pct(d.purchases.supplierOnTimeRate)} help="Recepciones de 180 días hechas en o antes de la fecha esperada de su OC." icon={IconTruckDelivery} />
              <KpiCard label="Compras del mes" value={`${fmtMoney(d.purchases.monthly.at(-1)?.amount ?? 0)} ${cur}`} hint={`${d.purchases.monthly.at(-1)?.orders ?? 0} órdenes`} icon={IconShoppingCart} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, lg: 3 }}>
              <div className="lg:col-span-2">
                <Text size="sm" fw={600} mb="xs">
                  Monto comprado por mes ({cur})
                </Text>
                <BarChart
                  h={220}
                  data={d.purchases.monthly.map((m) => ({ ...m, label: month(m.month) }))}
                  dataKey="label"
                  series={[{ name: "amount", label: "Compras", color: "orange.5" }]}
                  valueFormatter={(v) => fmtMoney(v)}
                  tickLine="y"
                />
              </div>
              <div>
                <Text size="sm" fw={600} mb="xs">
                  Principales proveedores (180 días)
                </Text>
                <RankTable rows={d.purchases.topSuppliers.map((s) => ({ name: s.supplier, value: s.amount }))} label="Proveedor" money={cur} />
              </div>
            </SimpleGrid>
          </Section>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          {d?.quality && (
            <Section title="Calidad" subtitle="Decisiones de los últimos 90 días">
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <KpiCard label="En cuarentena" value={int(d.quality.quarantine)} hint="lotes esperando decisión" icon={IconFlask} color="grape" onClick={() => navigate("/quality/lots")} />
                <KpiCard label="Aprobación" value={pct(d.quality.approvalRate)} hint={`${d.quality.approved90} aprobados · ${d.quality.rejected90} rechazados`} icon={IconPercentage} />
                <KpiCard
                  label="Días a liberar"
                  value={d.quality.avgReleaseDays === null ? "—" : fmtMoney(d.quality.avgReleaseDays, 1)}
                  help="Promedio de días entre la recepción o fabricación del lote y su aprobación."
                  icon={IconClockExclamation}
                />
              </SimpleGrid>
            </Section>
          )}
          {d?.planning && (
            <Section title="Planificación" subtitle={d.planning.lastRunAt ? `Último MRP: ${d.planning.period} · ${fmtDateTime(d.planning.lastRunAt)}` : "Aún no se ha corrido el MRP"}>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <KpiCard label="Fabricar" value={int(d.planning.openSuggestions.make)} hint="sugerencias abiertas" icon={IconCalendarStats} onClick={() => navigate("/production/planning")} />
                <KpiCard label="Comprar" value={int(d.planning.openSuggestions.buy)} hint="sugerencias abiertas" icon={IconShoppingCart} onClick={() => navigate("/production/planning")} />
                <KpiCard
                  label="Atrasadas"
                  value={int(d.planning.openSuggestions.late)}
                  hint="debían lanzarse antes de hoy"
                  icon={IconClockExclamation}
                  color={d.planning.openSuggestions.late ? "red" : "teal"}
                />
              </SimpleGrid>
            </Section>
          )}
        </SimpleGrid>
      </Stack>

      {d && (
        <Group justify="center" mt="lg">
          <Badge variant="light" color="gray">
            Cada bloque respeta sus permisos y su alcance de datos
          </Badge>
        </Group>
      )}
    </div>
  );
}
