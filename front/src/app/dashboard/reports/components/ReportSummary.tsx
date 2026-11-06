/**
 * @project FabriHub - Front
 * @file src/app/dashboard/reports/components/ReportSummary.tsx
 * @description Resumen de un reporte: indicadores (con su equivalente en dólares y la variación contra el
 * período anterior) y gráficos
 *
 * La variación lleva flecha y texto además del color (verde si mejora, rojo si empeora según el
 * indicador), así nunca depende solo del color. Los gráficos usan la paleta --viz-* (index.css):
 * una serie sola va en petrol; varias, en el orden fijo de la paleta, con leyenda. El mapa de calor
 * usa un solo tono (--viz-single) de claro a oscuro, con el valor escrito en cada celda.
 */

import { BarChart, DonutChart, LineChart } from "@mantine/charts";
import { Group, Paper, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { IconArrowDownRight, IconArrowRight, IconArrowUpRight, IconInfoCircle } from "@tabler/icons-react";
import dayjs from "dayjs";
import { fmtMoney } from "@utils/format";
import type { ReportChart, ReportKpi } from "../../dashboard.service";
import { fmtAxis, fmtValue } from "../format";

const VIZ = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];
/** Más categorías que colores: el resto se agrupa en «Otros» (gris) */
const OTHER = "var(--mantine-color-gray-5)";

const seriesColor = (count: number, i: number) => (count === 1 ? "var(--viz-single)" : VIZ[i % VIZ.length]);

function Change({ k, base }: Readonly<{ k: ReportKpi; base: string }>) {
  if (k.previous === null || k.previous === undefined || k.type === "text") return null;
  const prev = fmtValue(k.type, k.previous, base);
  if (k.change === null) {
    return (
      <Text size="xs" c="dimmed">
        Antes: {prev}
      </Text>
    );
  }
  const flat = Math.abs(k.change) < 0.005;
  const up = k.change > 0;
  const good = flat || !k.better ? null : (up && k.better === "up") || (!up && k.better === "down");
  const Icon = flat ? IconArrowRight : up ? IconArrowUpRight : IconArrowDownRight;
  const color = good === null ? "dimmed" : good ? "teal.7" : "red.7";
  return (
    <Group gap={2} wrap="nowrap">
      <Icon size={14} className={good === null ? "text-gray-400" : good ? "text-teal-700" : "text-red-700"} />
      <Text size="xs" c={color} fw={600}>
        {flat ? "Sin cambio" : `${up ? "+" : "−"}${fmtMoney(Math.abs(k.change) * 100, 1)} %`}
      </Text>
      <Text size="xs" c="dimmed" lineClamp={1}>
        · antes {prev}
      </Text>
    </Group>
  );
}

function KpiTile({ k, base: companyBase }: Readonly<{ k: ReportKpi; base: string }>) {
  const base = k.currency ?? companyBase;
  return (
    <Paper withBorder radius="md" p="sm">
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lineClamp={1}>
          {k.label}
        </Text>
        {k.help && (
          <Tooltip label={k.help} multiline w={260} withArrow>
            <IconInfoCircle size={14} className="shrink-0 text-gray-400" />
          </Tooltip>
        )}
      </Group>
      <Text fw={800} size={k.type === "text" ? "md" : "xl"} mt={2} lineClamp={k.type === "text" ? 2 : 1}>
        {fmtValue(k.type, k.value, base)}
      </Text>
      {k.usd !== null && (
        <Text size="xs" c="dimmed" ff="monospace">
          ≈ {fmtValue("money", k.usd, "USD")}
        </Text>
      )}
      <Change k={k} base={base} />
    </Paper>
  );
}

function Donut({ chart, base }: Readonly<{ chart: ReportChart; base: string }>) {
  const key = chart.series[0].key;
  const points = chart.data.map((p) => ({ name: p.label, value: Number(p[key]) || 0 })).filter((p) => p.value > 0);
  const head = points.slice(0, VIZ.length - (points.length > VIZ.length ? 1 : 0));
  const rest = points.slice(head.length);
  const data = [
    ...head.map((p, i) => ({ ...p, color: VIZ[i] })),
    ...(rest.length ? [{ name: "Otros", value: rest.reduce((s, p) => s + p.value, 0), color: OTHER }] : [])
  ];
  const total = data.reduce((s, p) => s + p.value, 0);
  return (
    <Group wrap="nowrap" align="center" gap="md">
      <DonutChart
        data={data}
        size={150}
        thickness={22}
        paddingAngle={2}
        withTooltip
        tooltipDataSource="segment"
        valueFormatter={(v) => fmtValue(chart.type, v, base)}
        chartLabel={fmtAxis(chart.type, total)}
      />
      <Stack gap={6} className="min-w-0 flex-1">
        {data.map((p) => (
          <Group key={p.name} gap={8} wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap" className="min-w-0">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} />
              <Text size="xs" lineClamp={1}>
                {p.name}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" className="whitespace-nowrap">
              {fmtValue(chart.type, p.value, base)} · {fmtMoney((p.value / total) * 100, 0)} %
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}

function Heatmap({ chart, base }: Readonly<{ chart: ReportChart; base: string }>) {
  const max = Math.max(0, ...chart.data.flatMap((p) => chart.series.map((s) => Number(p[s.key]) || 0)));
  const level = (v: number) => (max > 0 && v > 0 ? 0.12 + 0.88 * (v / max) : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {chart.series.map((s) => (
              <th key={s.key} className="px-1 pb-1 text-center text-xs font-semibold text-gray-500">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.data.map((p) => (
            <tr key={p.label}>
              <td className="whitespace-nowrap pr-2 text-right text-xs text-gray-500">{p.label}</td>
              {chart.series.map((s) => {
                const v = Number(p[s.key]) || 0;
                const l = level(v);
                return (
                  <td
                    key={s.key}
                    title={`${s.label} ${p.label}: ${fmtValue(chart.type, v, base)}`}
                    className="h-7 min-w-[52px] rounded text-center text-[11px] tabular-nums"
                    style={{
                      background: l ? `color-mix(in oklab, var(--viz-single) ${Math.round(l * 100)}%, transparent)` : "var(--mantine-color-default-hover)",
                      color: l > 0.55 ? "#fff" : undefined
                    }}
                  >
                    {v ? fmtAxis(chart.type, v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Group gap={6} justify="flex-end" mt={6}>
        <Text size="xs" c="dimmed">
          Menos
        </Text>
        {[0.12, 0.34, 0.56, 0.78, 1].map((l) => (
          <span key={l} className="h-3 w-5 rounded-sm" style={{ background: `color-mix(in oklab, var(--viz-single) ${l * 100}%, transparent)` }} />
        ))}
        <Text size="xs" c="dimmed">
          Más
        </Text>
      </Group>
    </div>
  );
}

function Chart({ chart, base: companyBase }: Readonly<{ chart: ReportChart; base: string }>) {
  const base = chart.currency ?? companyBase;
  const series = chart.series.map((s, i) => ({ name: s.key, label: s.label, color: seriesColor(chart.series.length, i) }));
  const valueFormatter = (v: number) => fmtValue(chart.type, v, base);
  const many = chart.series.length > 1;
  if (chart.kind === "donut") return <Donut chart={chart} base={base} />;
  if (chart.kind === "heatmap") return <Heatmap chart={chart} base={base} />;
  if (chart.kind === "line") {
    return (
      <LineChart
        h={240}
        data={chart.data}
        dataKey="label"
        series={series}
        curveType="linear"
        strokeWidth={2}
        dotProps={{ r: 3 }}
        activeDotProps={{ r: 5 }}
        withLegend={many}
        legendProps={{ verticalAlign: "top", height: 28 }}
        valueFormatter={valueFormatter}
        yAxisProps={{ tickFormatter: (v: number) => fmtAxis(chart.type, v), width: 56 }}
        gridAxis="y"
      />
    );
  }
  const labelWidth = chart.horizontal ? Math.min(180, Math.max(70, ...chart.data.map((p) => p.label.length * 6))) : undefined;
  return (
    <BarChart
      h={chart.horizontal ? Math.max(160, chart.data.length * 26 + 40) : 240}
      data={chart.data}
      dataKey="label"
      series={series}
      orientation={chart.horizontal ? "vertical" : "horizontal"}
      withLegend={many}
      legendProps={{ verticalAlign: "top", height: 28 }}
      valueFormatter={valueFormatter}
      barProps={{ radius: 4 }}
      maxBarWidth={28}
      gridAxis={chart.horizontal ? "x" : "y"}
      xAxisProps={chart.horizontal ? { tickFormatter: (v: number) => fmtAxis(chart.type, v) } : undefined}
      yAxisProps={
        chart.horizontal
          ? { width: labelWidth, tickFormatter: (v: string) => (v.length > 28 ? `${v.slice(0, 27)}…` : v) }
          : { tickFormatter: (v: number) => fmtAxis(chart.type, v), width: 56 }
      }
    />
  );
}

export default function ReportSummary({
  kpis,
  charts,
  previous,
  base
}: Readonly<{ kpis: ReportKpi[]; charts: ReportChart[]; previous: { from: string; to: string } | null; base: string }>) {
  if (!kpis.length && !charts.length) return null;
  return (
    <Stack gap="md" mb="lg">
      {kpis.length > 0 && (
        <div>
          <SimpleGrid cols={{ base: 2, sm: 3, xl: Math.min(kpis.length, 6) }} spacing="sm">
            {kpis.map((k) => (
              <KpiTile key={k.key} k={k} base={base} />
            ))}
          </SimpleGrid>
          {previous && (
            <Text size="xs" c="dimmed" mt={6}>
              Variación contra el {dayjs(previous.from).format("DD/MM/YYYY")}
              {previous.to !== previous.from ? ` al ${dayjs(previous.to).format("DD/MM/YYYY")}` : ""}.
            </Text>
          )}
        </div>
      )}
      {charts.length > 0 && (
        <SimpleGrid cols={{ base: 1, md: charts.length > 1 ? 2 : 1 }} spacing="md">
          {charts.map((c) => (
            <Paper key={c.title} withBorder radius="md" p="md" className={`min-w-0 ${c.kind === "heatmap" && charts.length > 1 ? "md:col-span-2" : ""}`}>
              <Text size="sm" fw={700} mb="sm">
                {c.title}
              </Text>
              <Chart chart={c} base={base} />
            </Paper>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
