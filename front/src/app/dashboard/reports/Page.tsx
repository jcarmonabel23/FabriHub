/**
 * @project FabriHub - Front
 * @file src/app/dashboard/reports/Page.tsx
 * @description Tablero → Reportes (DSH_REPORTS): vista previa y descarga en Excel
 *
 * El Excel lo arma la API con el permiso `download` y el alcance de datos del usuario; aquí solo se
 * elige el reporte y el rango. La lista muestra únicamente los reportes cuyo módulo de origen puede ver.
 */

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconDownload, IconFileSpreadsheet, IconTable } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { TbEmpty, TbLoader } from "@atoms/tables/DataTable";
import { fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { DASHBOARD_ACTIONS } from "../dashboardActions";
import { type ReportColumn, type ReportInfo, dashboardApi } from "../dashboard.service";

const QC_LABEL: Record<string, string> = { quarantine: "Cuarentena", approved: "Aprobado", rejected: "Rechazado", on_hold: "Retenido" };

function cell(c: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (c.type) {
    case "int":
      return fmtMoney(Number(v), 0);
    case "qty":
      return new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 }).format(Number(v));
    case "money":
      return fmtMoney(Number(v));
    case "pct":
      return `${fmtMoney(Number(v) * 100, 1)} %`;
    case "date":
      return dayjs(String(v)).format("DD/MM/YYYY");
    case "datetime":
      return dayjs(String(v)).format("DD/MM/YYYY HH:mm");
    default:
      return c.key === "qualityStatus" ? (QC_LABEL[String(v)] ?? String(v)) : String(v);
  }
}

function ReportCard({ r, active, onClick }: Readonly<{ r: ReportInfo; active: boolean; onClick: () => void }>) {
  return (
    <UnstyledButton
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${active ? "border-brand-300 bg-brand-50" : "border-gray-100 bg-white hover:bg-gray-50"}`}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant={active ? "filled" : "light"} color="petrol" radius="md">
          <IconFileSpreadsheet size={18} />
        </ThemeIcon>
        <div className="min-w-0">
          <Text size="sm" fw={700}>
            {r.name}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {r.description}
          </Text>
          <Badge size="xs" variant="light" color="gray" mt={4}>
            {r.moduleName}
          </Badge>
        </div>
      </Group>
    </UnstyledButton>
  );
}

export default function ReportsPage() {
  const reports = useQuery({ queryKey: ["dashboard", "reports"], queryFn: dashboardApi.reports });
  const [code, setCode] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(dayjs().subtract(30, "day").format("YYYY-MM-DD"));
  const [to, setTo] = useState<string | null>(dayjs().format("YYYY-MM-DD"));

  const selected = useMemo(() => reports.data?.find((r) => r.code === code) ?? reports.data?.[0] ?? null, [reports.data, code]);
  const range = useMemo(() => (selected?.ranged ? { from: from ?? undefined, to: to ?? undefined } : {}), [selected, from, to]);
  const badRange = Boolean(selected?.ranged && from && to && from > to);

  const preview = useQuery({
    queryKey: ["dashboard", "report-preview", selected?.code, range],
    queryFn: () => dashboardApi.preview(selected!.code, range),
    enabled: Boolean(selected) && !badRange
  });

  const download = useMutation({
    mutationFn: () => dashboardApi.download(selected!.code, range),
    onSuccess: () => notifySuccess(`«${selected!.name}» descargado`),
    onError: (err) => notifyError(err)
  });

  const p = preview.data;
  const totals = useMemo(() => {
    if (!p) return null;
    const cols = p.columns.filter((c) => c.total);
    if (cols.length === 0 || p.total > p.rows.length) return null;
    return Object.fromEntries(cols.map((c) => [c.key, p.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)]));
  }, [p]);

  return (
    <div className="p-6">
      <ModuleHeader title="Reportes" description="Reportes gerenciales con vista previa y descarga en Excel." actions={DASHBOARD_ACTIONS} />

      {reports.data?.length === 0 && (
        <Alert color="gray" variant="light">
          No tiene acceso de consulta a los módulos de origen de ningún reporte.
        </Alert>
      )}

      {selected && (
        <SimpleGrid cols={{ base: 1, lg: 4 }} spacing="lg">
          <Stack gap="xs">
            {reports.data!.map((r) => (
              <ReportCard key={r.code} r={r} active={r.code === selected.code} onClick={() => setCode(r.code)} />
            ))}
          </Stack>

          <Paper withBorder radius="lg" p="lg" className="lg:col-span-3 min-w-0">
            <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
              <div>
                <Text fw={700} size="lg">
                  {selected.name}
                </Text>
                <Text size="sm" c="dimmed">
                  {selected.description}
                </Text>
              </div>
              <Group gap="sm" align="flex-end">
                {selected.ranged && (
                  <>
                    <DateInput label="Desde" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} maxDate={to ?? undefined} w={140} />
                    <DateInput label="Hasta" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} minDate={from ?? undefined} w={140} />
                  </>
                )}
                <Button leftSection={<IconDownload size={16} />} loading={download.isPending} disabled={badRange || !p || p.total === 0} onClick={() => download.mutate()}>
                  Descargar Excel
                </Button>
              </Group>
            </Group>

            {preview.isLoading && <TbLoader />}
            {p && p.total === 0 && <TbEmpty text="El reporte no tiene filas con estos filtros" />}
            {p && p.total > 0 && (
              <>
                <Group gap="xs" mb="xs">
                  <IconTable size={16} className="text-gray-400" />
                  <Text size="xs" c="dimmed">
                    {p.total > p.rows.length ? `Vista previa de ${p.rows.length} de ${p.total} filas; el Excel trae todas.` : `${p.total} fila(s).`}
                  </Text>
                </Group>
                <ScrollArea type="auto" h={520}>
                  <Table striped highlightOnHover stickyHeader verticalSpacing={6} fz="xs" miw={p.columns.length * 110}>
                    <Table.Thead className="bg-gray-50">
                      <Table.Tr>
                        {p.columns.map((c) => (
                          <Table.Th key={c.key} className={`whitespace-nowrap text-gray-500 ${c.type === "text" ? "" : "text-right"}`}>
                            {c.header}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {p.rows.map((r, i) => (
                        <Table.Tr key={i}>
                          {p.columns.map((c) => (
                            <Table.Td key={c.key} className={c.type === "text" ? "" : "text-right whitespace-nowrap"}>
                              {cell(c, r[c.key])}
                            </Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                      {totals && (
                        <Table.Tr className="font-bold bg-gray-50">
                          {p.columns.map((c, i) => (
                            <Table.Td key={c.key} className={c.type === "text" ? "" : "text-right whitespace-nowrap"}>
                              {i === 0 ? "Totales" : c.key in totals ? cell(c, totals[c.key]) : ""}
                            </Table.Td>
                          ))}
                        </Table.Tr>
                      )}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </Paper>
        </SimpleGrid>
      )}
    </div>
  );
}
