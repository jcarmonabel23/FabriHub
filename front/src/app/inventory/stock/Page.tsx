/**
 * @project FabriHub - Front
 * @file src/app/inventory/stock\Page.tsx
 * @description Inventario → Existencias (INV_STOCK): saldos valorados, kárdex y alertas
 */

import { useMemo, useState } from "react";
import { Badge, Group, Paper, SegmentedControl, Select, SimpleGrid, Table, Tabs, Text, TextInput, ThemeIcon } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertTriangle, IconCalendarExclamation, IconCash, IconListDetails, IconPackages, IconSearch, IconStack2 } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable, { TbEmpty } from "@atoms/tables/DataTable";
import { fmtMoney } from "@utils/format";
import ProductSelect from "../components/ProductSelect";
import { INVENTORY_ACTIONS } from "../inventoryActions";
import { ExpiryBadge } from "../lots/Page";
import { inventoryApi } from "../services/inventory.service";
import { QUALITY_COLOR, QUALITY_LABEL, type ProductOption, type StockRow } from "../types";

const PAGE_SIZE = 25;

function StatCard({ label, value, icon: Icon, color }: Readonly<{ label: string; value: string; icon: typeof IconCash; color: string }>) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text size="xl" fw={800}>
            {value}
          </Text>
        </div>
        <ThemeIcon size={44} radius="md" variant="light" color={color}>
          <Icon size={24} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

function StockTab({ warehouses }: Readonly<{ warehouses: { value: string; label: string }[] }>) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"lot" | "product">("lot");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["inventory", "stock", { debounced, warehouseId, groupBy, page }],
    queryFn: () => inventoryApi.listStock({ search: debounced, warehouseId, groupBy, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<StockRow, unknown>[]>(() => {
    const cols: ColumnDef<StockRow, unknown>[] = [
      { header: "Almacén", size: 90, cell: ({ row: { original: r } }) => <Text size="sm" fw={600}>{r.warehouseCode}</Text> },
      {
        header: "Producto",
        cell: ({ row: { original: r } }) => (
          <div>
            <Text size="sm" fw={600}>
              {r.productCode}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {r.productName}
            </Text>
          </div>
        )
      }
    ];
    if (groupBy === "lot") {
      cols.push(
        {
          header: "Lote",
          cell: ({ row: { original: r } }) =>
            r.lotCode ? (
              <Group gap={4}>
                <Text size="sm">{r.lotCode}</Text>
                {r.qualityStatus && r.qualityStatus !== "approved" && (
                  <Badge size="xs" color={QUALITY_COLOR[r.qualityStatus]}>
                    {QUALITY_LABEL[r.qualityStatus]}
                  </Badge>
                )}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                —
              </Text>
            )
        },
        {
          header: "Vence",
          cell: ({ row: { original: r } }) => (
            <ExpiryBadge expiresOn={r.expiresOn ?? null} days={r.expiresOn ? dayjs(r.expiresOn).diff(dayjs().startOf("day"), "day") : null} />
          )
        }
      );
    }
    cols.push(
      {
        header: "Existencia",
        cell: ({ row: { original: r } }) => (
          <Text size="sm" ta="right" fw={600}>
            {fmtMoney(r.quantity, 2)} {r.unitCode}
          </Text>
        )
      },
      {
        header: "Disponible",
        cell: ({ row: { original: r } }) => (
          <Text size="sm" ta="right" c={r.reserved ? "orange" : undefined}>
            {fmtMoney(r.available, 2)}
          </Text>
        )
      },
      { header: "Costo prom.", cell: ({ row: { original: r } }) => <Text size="sm" ta="right">{fmtMoney(r.avgCost, 4)}</Text> },
      { header: "Valor", cell: ({ row: { original: r } }) => <Text size="sm" ta="right" fw={700}>{fmtMoney(r.value)}</Text> }
    );
    return cols;
  }, [groupBy]);

  return (
    <>
      <Group mb="md" gap="sm">
        <TextInput placeholder="Producto o lote" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={240} />
        <Select placeholder="Todos mis almacenes" clearable allowDeselect data={warehouses} value={warehouseId} onChange={(v) => (setWarehouseId(v), setPage(1))} w={240} />
        <SegmentedControl
          data={[
            { value: "lot", label: "Por lote" },
            { value: "product", label: "Por producto" }
          ]}
          value={groupBy}
          onChange={(v) => (setGroupBy(v as "lot" | "product"), setPage(1))}
        />
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(r) => `${r.warehouseId}-${r.productId}-${r.lotId ?? ""}`}
        emptyText="Sin existencias con esos filtros"
      />
    </>
  );
}

function KardexTab({ warehouses }: Readonly<{ warehouses: { value: string; label: string }[] }>) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const rows = useQuery({
    queryKey: ["inventory", "kardex", product?.id, warehouseId],
    queryFn: () => inventoryApi.kardex(product!.id, warehouseId!),
    enabled: Boolean(product && warehouseId)
  });
  const totals = (rows.data ?? []).reduce((a, r) => ({ in: a.in + r.qtyIn, out: a.out + r.qtyOut }), { in: 0, out: 0 });

  return (
    <>
      <Group mb="md" gap="sm" align="flex-end">
        <ProductSelect label="Producto" w={380} stockable value={product} onChange={setProduct} />
        <Select label="Almacén" data={warehouses} value={warehouseId} onChange={setWarehouseId} w={240} />
      </Group>
      {!product || !warehouseId ? (
        <TbEmpty text="Elija producto y almacén para ver su kárdex" />
      ) : (
        <Paper withBorder radius="lg" className="overflow-x-auto">
          <Table striped highlightOnHover fz="sm" miw={900}>
            <Table.Thead className="bg-gray-50">
              <Table.Tr>
                <Table.Th>Fecha</Table.Th>
                <Table.Th>Movimiento</Table.Th>
                <Table.Th>Concepto</Table.Th>
                <Table.Th>Lote</Table.Th>
                <Table.Th ta="right">Entrada</Table.Th>
                <Table.Th ta="right">Salida</Table.Th>
                <Table.Th ta="right">Costo unit.</Table.Th>
                <Table.Th ta="right">Saldo</Table.Th>
                <Table.Th ta="right">Costo prom.</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(rows.data ?? []).map((r) => (
                <Table.Tr key={`${r.movementId}-${r.lineNo}`}>
                  <Table.Td>{dayjs(r.movementDate).format("DD/MM/YYYY")}</Table.Td>
                  <Table.Td>
                    <Text size="sm" td={r.status === "reversed" ? "line-through" : undefined}>
                      {r.number}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {r.conceptName}
                    {r.counterpart && (
                      <Text span size="xs" c="dimmed">
                        {" "}
                        ({r.counterpart})
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{r.lotCode ?? "—"}</Table.Td>
                  <Table.Td ta="right" c="teal.7">
                    {r.qtyIn ? fmtMoney(r.qtyIn, 2) : ""}
                  </Table.Td>
                  <Table.Td ta="right" c="red.7">
                    {r.qtyOut ? fmtMoney(r.qtyOut, 2) : ""}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(r.unitCost, 4)}</Table.Td>
                  <Table.Td ta="right" fw={700}>
                    {fmtMoney(r.balance, 2)}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(r.avgCost, 4)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th colSpan={4}>Totales del período</Table.Th>
                <Table.Th ta="right">{fmtMoney(totals.in, 2)}</Table.Th>
                <Table.Th ta="right">{fmtMoney(totals.out, 2)}</Table.Th>
                <Table.Th colSpan={3} />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
          {rows.data?.length === 0 && <TbEmpty text="Sin movimientos de ese producto en ese almacén" />}
        </Paper>
      )}
    </>
  );
}

function AlertsTab() {
  const alerts = useQuery({ queryKey: ["inventory", "alerts"], queryFn: inventoryApi.alerts });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Paper withBorder radius="lg" p="md">
        <Group gap="xs" mb="sm">
          <IconAlertTriangle size={18} className="text-orange-500" />
          <Text fw={700}>Fuera de mínimo / máximo</Text>
        </Group>
        {alerts.data?.stock.length === 0 ? (
          <TbEmpty text="Todo dentro de sus políticas" />
        ) : (
          <Table fz="sm" striped>
            <Table.Tbody>
              {(alerts.data?.stock ?? []).map((a) => (
                <Table.Tr key={`${a.warehouseCode}-${a.productId}`}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {a.productCode}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {a.warehouseCode} · {a.productName}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Badge color={a.kind === "below_min" ? "red" : "orange"}>
                      {fmtMoney(a.quantity, 2)} {a.unitCode}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {a.kind === "below_min" ? `mín. ${fmtMoney(a.minQty, 2)}` : `máx. ${fmtMoney(a.maxQty ?? 0, 2)}`}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
      <Paper withBorder radius="lg" p="md">
        <Group gap="xs" mb="sm">
          <IconCalendarExclamation size={18} className="text-red-500" />
          <Text fw={700}>Lotes vencidos o por vencer</Text>
        </Group>
        {alerts.data?.lots.length === 0 ? (
          <TbEmpty text="Sin lotes próximos a vencer" />
        ) : (
          <Table fz="sm" striped>
            <Table.Tbody>
              {(alerts.data?.lots ?? []).map((l) => (
                <Table.Tr key={l.lotId}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {l.productCode} · {l.lotCode}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {l.productName} · {fmtMoney(l.quantity, 2)} {l.unitCode}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <ExpiryBadge expiresOn={l.expiresOn} days={l.daysLeft} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </div>
  );
}

export default function StockPage() {
  const summary = useQuery({ queryKey: ["inventory", "summary"], queryFn: inventoryApi.summary });
  // Solo los almacenes del alcance del usuario (los demás la API no los mostraría)
  const whLookup = useQuery({ queryKey: ["inventory", "stock-warehouses"], queryFn: inventoryApi.stockWarehouses });
  const warehouses = (whLookup.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const s = summary.data;

  return (
    <div className="p-6">
      <ModuleHeader title="Existencias" description="Saldos valorados a costo promedio, kárdex y alertas" actions={INVENTORY_ACTIONS} />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
        <StatCard label="Valor del inventario" value={s ? fmtMoney(s.totalValue) : "…"} icon={IconCash} color="petrol" />
        <StatCard label="Productos con existencia" value={s ? String(s.productsWithStock) : "…"} icon={IconPackages} color="blue" />
        <StatCard label="Alertas de stock" value={s ? String(s.stockAlerts) : "…"} icon={IconAlertTriangle} color={s?.stockAlerts ? "orange" : "gray"} />
        <StatCard label="Lotes por vencer" value={s ? String(s.lotAlerts) : "…"} icon={IconCalendarExclamation} color={s?.lotAlerts ? "red" : "gray"} />
      </SimpleGrid>
      <Tabs defaultValue="stock" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="stock" leftSection={<IconStack2 size={16} />}>
            Existencias
          </Tabs.Tab>
          <Tabs.Tab value="kardex" leftSection={<IconListDetails size={16} />}>
            Kárdex
          </Tabs.Tab>
          <Tabs.Tab value="alerts" leftSection={<IconAlertTriangle size={16} />} rightSection={s && s.stockAlerts + s.lotAlerts > 0 ? <Badge size="xs" color="red">{s.stockAlerts + s.lotAlerts}</Badge> : null}>
            Alertas
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="stock">
          <StockTab warehouses={warehouses} />
        </Tabs.Panel>
        <Tabs.Panel value="kardex">
          <KardexTab warehouses={warehouses} />
        </Tabs.Panel>
        <Tabs.Panel value="alerts">
          <AlertsTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
