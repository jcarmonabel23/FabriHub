/**
 * @project FabriHub - Front
 * @file src/app/production/formulas/Page.tsx
 * @description Producción → Fórmulas (PRD_FORMULAS): listado, detalle, explosión / verificar existencia e implosión
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Drawer, Group, Loader, NumberInput, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCopy, IconPencil, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { confirmDelete } from "@utils/confirm";
import { fmtMoney, fmtPct } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { PRODUCTION_ACTIONS } from "../productionActions";
import { productionApi } from "../services/production.service";
import type { Formula, FormulaDetail } from "../types";
import ExplosionTable from "../components/ExplosionTable";
import FormulaEditor from "./FormulaEditor";

const MODULE = "PRD_FORMULAS";
const qty = (v: number) => fmtMoney(v, v % 1 === 0 ? 0 : 3);

function FormulaDrawer({ id, onClose, onEdit, onNewVersion }: Readonly<{ id: string | null; onClose: () => void; onEdit: (f: FormulaDetail) => void; onNewVersion: (f: FormulaDetail) => void }>) {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const detail = useQuery({ queryKey: ["production", "formulas", id], queryFn: () => productionApi.getFormula(id!), enabled: Boolean(id) });
  const f = detail.data;
  const [quantity, setQuantity] = useState<number | string>(0);
  const [debouncedQty] = useDebouncedValue(Number(quantity) || 0, 400);
  useEffect(() => setQuantity(f?.baseQuantity ?? 0), [f?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useMutation({
    mutationFn: () => productionApi.deleteFormula(id!),
    onSuccess: () => {
      notifySuccess("Fórmula eliminada");
      qc.invalidateQueries({ queryKey: ["production", "formulas"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title="Fórmula">
      {!f ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <div>
            <Title order={4}>
              {f.code} <Badge variant="light">v{f.version}</Badge> {f.isDefault && <Badge color="teal">Por defecto</Badge>} {!f.isActive && <Badge color="gray">Inactiva</Badge>}
            </Title>
            <Text fw={600}>
              {f.productCode} · {f.productName}
            </Text>
            <Text size="sm" c="dimmed">
              Rinde {qty(f.baseQuantity)} {f.unitCode} · ruta {f.routeCode ?? "—"} · vigente desde {f.validFrom} · {f.orders} orden(es)
            </Text>
          </div>
          <Group gap="xs">
            {can("edit") && (
              <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={() => onEdit(f)}>
                Editar
              </Button>
            )}
            {can("add_new") && (
              <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => onNewVersion(f)}>
                Nueva versión
              </Button>
            )}
            {can("delete") && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(`la fórmula ${f.code}`, () => remove.mutate())}>
                Eliminar
              </Button>
            )}
          </Group>
          <Tabs defaultValue="components" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="components">Componentes</Tabs.Tab>
              <Tabs.Tab value="explode">Explosión y existencia</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="components" pt="sm">
              <Table withTableBorder striped fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Componente</Table.Th>
                    <Table.Th ta="right">Cantidad</Table.Th>
                    <Table.Th ta="right">Merma</Table.Th>
                    <Table.Th>Etapa</Table.Th>
                    <Table.Th ta="right">Costo</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {f.lines.map((l) => (
                    <Table.Tr key={l.id}>
                      <Table.Td>
                        <Group gap={6}>
                          <Text size="sm" fw={600}>
                            {l.componentCode}
                          </Text>
                          {l.isCritical && <Badge size="xs" color="red" variant="light">Crítico</Badge>}
                          {l.hasFormula && <Badge size="xs" color="violet" variant="light">Fabricado</Badge>}
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {l.componentName}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        {qty(l.quantity)} {l.unitCode}
                      </Table.Td>
                      <Table.Td ta="right">{l.scrapPct ? fmtPct(l.scrapPct) : "—"}</Table.Td>
                      <Table.Td>{l.stageCode ?? "—"}</Table.Td>
                      <Table.Td ta="right">{fmtMoney(l.quantity * (1 + l.scrapPct / 100) * l.stdCost)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="sm" ta="right" mt="xs">
                Materiales: <b>{fmtMoney(f.materialCost)}</b> · por {f.unitCode}: <b>{fmtMoney(f.materialUnitCost, 4)}</b>
              </Text>
            </Tabs.Panel>
            <Tabs.Panel value="explode" pt="sm">
              <NumberInput label={`Cantidad a fabricar (${f.unitCode})`} min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={quantity} onChange={setQuantity} maw={260} mb="sm" />
              {debouncedQty > 0 && <ExplosionTable productId={f.productId} quantity={debouncedQty} formulaId={f.id} />}
            </Tabs.Panel>
          </Tabs>
          {f.notes && (
            <Text size="sm" style={{ whiteSpace: "pre-line" }}>
              {f.notes}
            </Text>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

/** Load Implosión: dónde se usa un componente */
function WhereUsed() {
  const [component, setComponent] = useState<ProductOption | null>(null);
  const imp = useQuery({ queryKey: ["production", "implode", component?.id], queryFn: () => productionApi.implode(component!.id), enabled: Boolean(component) });
  return (
    <Stack>
      <ProductSelect label="Componente" stockable value={component} onChange={setComponent} maw={480} />
      {component && imp.data && imp.data.length === 0 && <Text c="dimmed">{component.code} no se usa en ninguna fórmula activa.</Text>}
      {imp.data && imp.data.length > 0 && (
        <Table withTableBorder fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Producto</Table.Th>
              <Table.Th>Fórmula</Table.Th>
              <Table.Th ta="right">Usa</Table.Th>
              <Table.Th>Cadena</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {imp.data.map((r) => (
              <Table.Tr key={r.path}>
                <Table.Td style={{ paddingLeft: 8 + (r.level - 1) * 22 }}>
                  <Text size="sm" fw={r.level === 1 ? 600 : 400}>
                    {r.productCode}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.productName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {r.formulaCode} v{r.version} {r.isDefault && <Badge size="xs" color="teal" variant="light">Por defecto</Badge>}
                </Table.Td>
                <Table.Td ta="right">
                  {qty(r.quantity)} {r.usedUnitCode} de {r.usedCode} por {qty(r.baseQuantity)} {r.productUnitCode}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {r.path}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function SimulateExplosion() {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [quantity, setQuantity] = useState<number | string>(1000);
  const [debouncedQty] = useDebouncedValue(Number(quantity) || 0, 400);
  return (
    <Stack>
      <Group align="flex-end">
        <ProductSelect label="Producto a fabricar" only="manufactured" stockable value={product} onChange={setProduct} w={420} />
        <NumberInput label="Cantidad" min={0} decimalScale={4} thousandSeparator="." decimalSeparator="," value={quantity} onChange={setQuantity} w={180} />
      </Group>
      {product && debouncedQty > 0 && <ExplosionTable productId={product.id} quantity={debouncedQty} />}
    </Stack>
  );
}

export default function FormulasPage() {
  const can = useCan(MODULE);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 300);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; formula: FormulaDetail | null }>({ open: false, formula: null });
  const list = useQuery({ queryKey: ["production", "formulas", { debounced }], queryFn: () => productionApi.listFormulas({ search: debounced }) });

  const columns = useMemo<ColumnDef<Formula, unknown>[]>(
    () => [
      {
        header: "Producto",
        cell: ({ row: { original: f } }) => (
          <div>
            <Text size="sm" fw={700}>
              {f.productCode}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {f.productName}
            </Text>
          </div>
        )
      },
      {
        header: "Fórmula",
        cell: ({ row: { original: f } }) => (
          <Group gap={6}>
            <Text size="sm">{f.code}</Text>
            <Badge size="xs" variant="light">v{f.version}</Badge>
            {f.isDefault && <Badge size="xs" color="teal">Por defecto</Badge>}
            {!f.isActive && <Badge size="xs" color="gray">Inactiva</Badge>}
          </Group>
        )
      },
      { header: "Rinde", cell: ({ row: { original: f } }) => <Text size="sm">{qty(f.baseQuantity)} {f.unitCode}</Text> },
      { header: "Componentes", cell: ({ row: { original: f } }) => <Text size="sm">{f.components}</Text> },
      { header: "Ruta", cell: ({ row: { original: f } }) => <Text size="sm">{f.routeCode ?? "—"}</Text> },
      { header: "Órdenes", cell: ({ row: { original: f } }) => <Text size="sm">{f.orders}</Text> }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Fórmulas"
        description="Listas de materiales: explosión, implosión y verificación de existencia"
        actions={PRODUCTION_ACTIONS}
        right={can("add_new") && <Button leftSection={<IconPlus size={16} />} onClick={() => setEditor({ open: true, formula: null })}>Nueva fórmula</Button>}
      />
      <Tabs defaultValue="list" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="list">Fórmulas</Tabs.Tab>
          <Tabs.Tab value="explode">Explosión</Tabs.Tab>
          <Tabs.Tab value="implode">Implosión (dónde se usa)</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="list">
          <Group mb="md">
            <TextInput placeholder="Producto o fórmula" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
          </Group>
          <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(f) => f.id} onRowClick={(f) => setDetailId(f.id)} />
        </Tabs.Panel>
        <Tabs.Panel value="explode">
          <SimulateExplosion />
        </Tabs.Panel>
        <Tabs.Panel value="implode">
          <WhereUsed />
        </Tabs.Panel>
      </Tabs>
      <FormulaEditor opened={editor.open} formula={editor.formula} onClose={() => setEditor({ open: false, formula: null })} onSaved={(f) => setDetailId(f.id)} />
      <FormulaDrawer
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(f) => setEditor({ open: true, formula: f })}
        onNewVersion={(f) => {
          // Nueva versión: mismo producto y componentes, código con sufijo de versión
          setDetailId(null);
          setEditor({ open: true, formula: { ...f, id: "", code: `${f.code.replace(/-\d+$/, "")}-${f.version + 1}`, isDefault: false } as FormulaDetail });
        }}
      />
    </div>
  );
}
