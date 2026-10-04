/**
 * @project FabriHub - Front
 * @file src/global/atoms/tables/DataTable.tsx
 * @description Tabla estándar: TanStack Table + Mantine Table, con carga, vacío, contador y paginación
 */

import { Group, Loader, Pagination, Paper, ScrollArea, Stack, Table, Text, ThemeIcon } from "@mantine/core";
import { IconDatabaseOff } from "@tabler/icons-react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T) => string;
}

export function TbEmpty({ text = "No hay registros para mostrar" }: Readonly<{ text?: string }>) {
  return (
    <Stack align="center" gap="xs" py={48}>
      <ThemeIcon size={48} radius="xl" variant="light" color="gray">
        <IconDatabaseOff size={24} />
      </ThemeIcon>
      <Text size="sm" c="dimmed">
        {text}
      </Text>
    </Stack>
  );
}

export function TbLoader() {
  return (
    <Stack align="center" py={48}>
      <Loader size="sm" />
    </Stack>
  );
}

export default function DataTable<T>({
  data,
  columns,
  loading,
  total,
  page = 1,
  pageSize = 25,
  onPageChange,
  emptyText,
  onRowClick,
  rowKey
}: Readonly<DataTableProps<T>>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <Paper withBorder radius="lg" className="overflow-hidden">
      <ScrollArea type="auto">
        <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md" miw={720}>
          <Table.Thead className="bg-gray-50">
            {table.getHeaderGroups().map((hg) => (
              <Table.Tr key={hg.id}>
                {hg.headers.map((h) => (
                  <Table.Th key={h.id} className="text-xs uppercase tracking-wide text-gray-500" style={{ width: h.column.columnDef.size }}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </Table.Th>
                ))}
              </Table.Tr>
            ))}
          </Table.Thead>
          <Table.Tbody>
            {!loading &&
              table.getRowModel().rows.map((row) => (
                <Table.Tr
                  key={rowKey ? rowKey(row.original) : row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {loading && <TbLoader />}
      {!loading && data.length === 0 && <TbEmpty text={emptyText} />}
      {total !== undefined && (
        <Group justify="space-between" px="md" py="sm" className="border-t border-gray-100">
          <Text size="xs" c="dimmed">
            {total} registro(s)
          </Text>
          {pages > 1 && onPageChange && <Pagination size="sm" total={pages} value={page} onChange={onPageChange} />}
        </Group>
      )}
    </Paper>
  );
}
