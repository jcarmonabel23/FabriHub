/**
 * @project FabriHub - Front
 * @file src/app/production/formulas/FormulaEditor.tsx
 * @description Alta/edición de una fórmula: producto, cantidad base, ruta y componentes (merma, crítico, etapa)
 */

import { useEffect, useState } from "react";
import { ActionIcon, Button, Checkbox, Group, NumberInput, Paper, Select, Switch, Table, Text, TextInput, Textarea } from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "@atoms/forms/FormModal";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { settingsApi } from "@/app/settings/services/settings.service";
import { notifyError, notifySuccess } from "@utils/notify";
import { productionApi } from "../services/production.service";
import type { FormulaDetail } from "../types";

interface LineForm {
  key: number;
  component: ProductOption | null;
  quantity: number | string;
  scrapPct: number | string;
  isCritical: boolean;
  stageId: string | null;
}

let seq = 0;
const blankLine = (): LineForm => ({ key: ++seq, component: null, quantity: "", scrapPct: 0, isCritical: false, stageId: null });

const asOption = (id: string, code: string, name: string, unitCode: string): ProductOption => ({
  id,
  code,
  name,
  unitCode,
  unitDecimals: 6,
  isLotControlled: false,
  isStockable: true,
  shelfLifeDays: null,
  isOnHold: false
});

export default function FormulaEditor({
  opened,
  formula,
  onClose,
  onSaved
}: Readonly<{ opened: boolean; formula: FormulaDetail | null; onClose: () => void; onSaved: (f: FormulaDetail) => void }>) {
  const qc = useQueryClient();
  const stages = useQuery({ queryKey: ["lookup", "stages"], queryFn: () => settingsApi.lookup("stages"), enabled: opened });
  const routes = useQuery({ queryKey: ["lookup", "routes"], queryFn: () => settingsApi.lookup("routes"), enabled: opened });
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [f, setF] = useState({ code: "", name: "", baseQuantity: 1 as number | string, routeId: null as string | null, isDefault: false, isActive: true, notes: "" });
  const [lines, setLines] = useState<LineForm[]>([]);
  // Una fórmula sin id es una plantilla (nueva versión): se precarga pero se guarda como alta.
  const isEdit = Boolean(formula?.id);

  useEffect(() => {
    if (!opened) return;
    if (formula) {
      setProduct(asOption(formula.productId, formula.productCode, formula.productName, formula.unitCode));
      setF({ code: formula.code, name: formula.name, baseQuantity: formula.baseQuantity, routeId: formula.routeId, isDefault: formula.isDefault, isActive: formula.isActive, notes: formula.notes ?? "" });
      setLines(
        formula.lines.map((l) => ({
          key: ++seq,
          component: asOption(l.componentId, l.componentCode, l.componentName, l.unitCode),
          quantity: l.quantity,
          scrapPct: l.scrapPct,
          isCritical: l.isCritical,
          stageId: l.stageId
        }))
      );
    } else {
      setProduct(null);
      setF({ code: "", name: "", baseQuantity: 1, routeId: null, isDefault: false, isActive: true, notes: "" });
      setLines([blankLine()]);
    }
  }, [opened, formula]);

  const complete = lines.filter((l) => l.component && Number(l.quantity) > 0);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        baseQuantity: Number(f.baseQuantity),
        routeId: f.routeId,
        isDefault: f.isDefault,
        isActive: f.isActive,
        notes: f.notes || null,
        lines: complete.map((l) => ({ componentId: l.component!.id, quantity: Number(l.quantity), scrapPct: Number(l.scrapPct || 0), isCritical: l.isCritical, stageId: l.stageId }))
      };
      return isEdit ? productionApi.updateFormula(formula!.id, body) : productionApi.createFormula({ ...body, productId: product?.id, code: f.code });
    },
    onSuccess: (data) => {
      notifySuccess(`Fórmula ${data.code} v${data.version} guardada`);
      qc.invalidateQueries({ queryKey: ["production", "formulas"] });
      onSaved(data);
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const set = (key: number, patch: Partial<LineForm>) => setLines((x) => x.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const valid = Boolean(product) && f.name.trim().length >= 2 && (isEdit || f.code.trim().length > 0) && Number(f.baseQuantity) > 0 && complete.length > 0;

  return (
    <FormModal opened={opened} onClose={onClose} title={isEdit ? `Fórmula ${formula!.code} · versión ${formula!.version}` : formula ? `Nueva versión de ${formula.productCode}` : "Nueva fórmula"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid} size="80rem">
      <Group grow align="flex-start">
        <ProductSelect label="Producto que fabrica" required only="manufactured" stockable value={product} onChange={setProduct} disabled={Boolean(formula)} />
        <TextInput label="Código" required disabled={isEdit} value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} maxLength={30} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Group>
      <Group grow align="flex-start">
        <NumberInput
          label="Cantidad base"
          description={`Lo que rinden los componentes${product ? ` (${product.unitCode})` : ""}`}
          min={0}
          decimalScale={6}
          thousandSeparator="."
          decimalSeparator=","
          value={f.baseQuantity}
          onChange={(v) => setF({ ...f, baseQuantity: v })}
        />
        <Select label="Ruta" description="Etapas y tiempos de fabricación" clearable searchable data={(routes.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} value={f.routeId} onChange={(v) => setF({ ...f, routeId: v })} />
        <Group mt={28}>
          <Switch label="Por defecto" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.currentTarget.checked })} />
          <Switch label="Activa" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.currentTarget.checked })} />
        </Group>
      </Group>
      <Paper withBorder radius="md" className="overflow-x-auto">
        <Table verticalSpacing={6} miw={900}>
          <Table.Thead className="bg-gray-50">
            <Table.Tr>
              <Table.Th>Componente</Table.Th>
              <Table.Th w={150}>Cantidad</Table.Th>
              <Table.Th w={110}>Merma %</Table.Th>
              <Table.Th w={190}>Etapa</Table.Th>
              <Table.Th w={80}>Crítico</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l) => (
              <Table.Tr key={l.key}>
                <Table.Td>
                  <ProductSelect size="xs" stockable value={l.component} onChange={(p) => set(l.key, { component: p })} excludeIds={[product?.id ?? "", ...lines.filter((x) => x.key !== l.key && x.component).map((x) => x.component!.id)]} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" min={0} decimalScale={6} thousandSeparator="." decimalSeparator="," value={l.quantity} onChange={(v) => set(l.key, { quantity: v })} rightSection={<Text size="xs" c="dimmed">{l.component?.unitCode}</Text>} rightSectionWidth={52} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" min={0} max={99.99} decimalScale={2} decimalSeparator="," value={l.scrapPct} onChange={(v) => set(l.key, { scrapPct: v })} />
                </Table.Td>
                <Table.Td>
                  <Select size="xs" clearable data={(stages.data ?? []).map((s) => ({ value: s.id, label: s.code }))} value={l.stageId} onChange={(v) => set(l.key, { stageId: v })} />
                </Table.Td>
                <Table.Td>
                  <Checkbox checked={l.isCritical} onChange={(e) => set(l.key, { isCritical: e.currentTarget.checked })} aria-label="Crítico" />
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" aria-label="Quitar" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>
                    <IconX size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Group justify="space-between">
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setLines((x) => [...x, blankLine()])}>
          Agregar componente
        </Button>
        <Text size="xs" c="dimmed">
          Un componente crítico impide liberar la orden si falta. La merma se suma a la cantidad requerida.
        </Text>
      </Group>
      <Textarea label="Observaciones" autosize minRows={1} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
    </FormModal>
  );
}
