/**
 * @project FabriHub - Front
 * @file src/app/production/orders/OrderEditor.tsx
 * @description Crear / editar una orden de producción (estado creada) con verificación de existencia en vivo
 */

import { useEffect, useMemo, useState } from "react";
import { Divider, Group, NumberInput, Select, Text, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import FormModal from "@atoms/forms/FormModal";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { settingsApi } from "@/app/settings/services/settings.service";
import { notifyError, notifySuccess } from "@utils/notify";
import ExplosionTable from "../components/ExplosionTable";
import { productionApi } from "../services/production.service";
import type { ProductionOrderDetail } from "../types";

const PRIORITIES = [
  { value: "1", label: "1 · Urgente" },
  { value: "2", label: "2 · Alta" },
  { value: "3", label: "3 · Normal" },
  { value: "4", label: "4 · Baja" },
  { value: "5", label: "5 · Mínima" }
];

export default function OrderEditor({
  opened,
  order,
  onClose,
  onSaved
}: Readonly<{ opened: boolean; order: ProductionOrderDetail | null; onClose: () => void; onSaved: (o: ProductionOrderDetail) => void }>) {
  const qc = useQueryClient();
  const centers = useQuery({ queryKey: ["production", "centers"], queryFn: productionApi.listCenters, enabled: opened });
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: opened });
  const [product, setProduct] = useState<ProductOption | null>(null);
  const formulas = useQuery({
    queryKey: ["production", "formulas", { productId: product?.id }],
    queryFn: () => productionApi.listFormulas({ productId: product!.id }),
    enabled: opened && Boolean(product)
  });
  const [f, setF] = useState({
    formulaId: null as string | null,
    quantity: "" as number | string,
    plannedStart: dayjs().format("YYYY-MM-DD") as string | null,
    plannedEnd: null as string | null,
    priority: "3",
    productionCenterId: null as string | null,
    materialsWarehouseId: null as string | null,
    outputWarehouseId: null as string | null,
    lotCode: "",
    notes: ""
  });

  useEffect(() => {
    if (!opened) return;
    if (order) {
      setProduct({ id: order.productId, code: order.productCode, name: order.productName, unitCode: order.unitCode, unitDecimals: 2, isLotControlled: order.isLotControlled, isStockable: true, shelfLifeDays: order.shelfLifeDays, isOnHold: false });
      setF({
        formulaId: order.formulaId,
        quantity: order.quantityPlanned,
        plannedStart: order.plannedStart,
        plannedEnd: order.plannedEnd,
        priority: String(order.priority),
        productionCenterId: order.productionCenterId,
        materialsWarehouseId: order.materialsWarehouseId,
        outputWarehouseId: order.outputWarehouseId,
        lotCode: order.lotCode ?? "",
        notes: order.notes ?? ""
      });
    } else {
      setProduct(null);
      setF({ formulaId: null, quantity: "", plannedStart: dayjs().format("YYYY-MM-DD"), plannedEnd: null, priority: "3", productionCenterId: null, materialsWarehouseId: null, outputWarehouseId: null, lotCode: "", notes: "" });
    }
  }, [opened, order]);

  // Al elegir producto: su fórmula por defecto y el centro / almacenes de la ruta
  useEffect(() => {
    if (order || !formulas.data) return;
    const def = formulas.data.find((x) => x.isDefault && x.isActive) ?? formulas.data.find((x) => x.isActive);
    setF((x) => ({ ...x, formulaId: def?.id ?? null }));
  }, [formulas.data, order]);
  const formula = formulas.data?.find((x) => x.id === f.formulaId);
  useEffect(() => {
    if (order || !formula?.routeId) return;
    productionApi.getRoute(formula.routeId).then((r) => {
      const c = centers.data?.find((x) => x.id === r.productionCenterId);
      setF((x) => ({ ...x, productionCenterId: c?.id ?? x.productionCenterId, materialsWarehouseId: c?.materialsWarehouseId ?? x.materialsWarehouseId, outputWarehouseId: c?.outputWarehouseId ?? x.outputWarehouseId }));
    }).catch(() => undefined);
  }, [formula?.routeId, centers.data, order]);

  const [debouncedQty] = useDebouncedValue(Number(f.quantity) || 0, 400);
  const whOptions = useMemo(() => (warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` })), [warehouses.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        quantity: Number(f.quantity),
        plannedStart: f.plannedStart,
        plannedEnd: f.plannedEnd,
        priority: Number(f.priority),
        productionCenterId: f.productionCenterId,
        materialsWarehouseId: f.materialsWarehouseId,
        outputWarehouseId: f.outputWarehouseId,
        lotCode: f.lotCode.trim() || null,
        notes: f.notes || null
      };
      return order ? productionApi.updateOrder(order.id, body) : productionApi.createOrder({ ...body, productId: product?.id, formulaId: f.formulaId });
    },
    onSuccess: (data) => {
      notifySuccess(`Orden ${data.number} ${order ? "actualizada" : "creada"}`);
      qc.invalidateQueries({ queryKey: ["production", "orders"] });
      onSaved(data);
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const valid = Boolean(product) && Boolean(f.formulaId) && Number(f.quantity) > 0 && Boolean(f.plannedStart) && Boolean(f.materialsWarehouseId) && Boolean(f.outputWarehouseId) && (!f.plannedEnd || !f.plannedStart || f.plannedEnd >= f.plannedStart);

  return (
    <FormModal opened={opened} onClose={onClose} title={order ? `Editar ${order.number}` : "Nueva orden de producción"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid} size="72rem">
      <Group grow align="flex-start">
        <ProductSelect label="Producto a fabricar" required only="manufactured" stockable value={product} onChange={setProduct} disabled={Boolean(order)} />
        <Select
          label="Fórmula"
          required
          disabled={Boolean(order) || !product}
          data={(formulas.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.code} · v${x.version}${x.isDefault ? " (por defecto)" : ""}` }))}
          value={f.formulaId}
          onChange={(v) => setF({ ...f, formulaId: v })}
          nothingFoundMessage="El producto no tiene fórmulas"
        />
        <NumberInput
          label="Cantidad a fabricar"
          required
          min={0}
          decimalScale={4}
          thousandSeparator="."
          decimalSeparator=","
          value={f.quantity}
          onChange={(v) => setF({ ...f, quantity: v })}
          rightSection={<Text size="xs" c="dimmed">{product?.unitCode}</Text>}
          rightSectionWidth={52}
        />
      </Group>
      <Group grow align="flex-start">
        <DateInput label="Inicio planificado" required valueFormat="DD/MM/YYYY" value={f.plannedStart} onChange={(v) => setF({ ...f, plannedStart: v })} />
        <DateInput label="Fin planificado" clearable valueFormat="DD/MM/YYYY" minDate={f.plannedStart ?? undefined} value={f.plannedEnd} onChange={(v) => setF({ ...f, plannedEnd: v })} />
        <Select label="Prioridad" data={PRIORITIES} value={f.priority} onChange={(v) => setF({ ...f, priority: v ?? "3" })} />
        <TextInput label="Lote a fabricar" placeholder="Se indica al crear o al confirmar" value={f.lotCode} onChange={(e) => setF({ ...f, lotCode: e.currentTarget.value })} maxLength={40} />
      </Group>
      <Group grow align="flex-start">
        <Select label="Centro de producción" clearable data={(centers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} value={f.productionCenterId} onChange={(v) => setF({ ...f, productionCenterId: v })} />
        <Select label="Almacén de materiales" description="Si no alcanza, se toma del almacén con más disponible" required data={whOptions} value={f.materialsWarehouseId} onChange={(v) => setF({ ...f, materialsWarehouseId: v })} />
        <Select label="Almacén del terminado" required data={whOptions} value={f.outputWarehouseId} onChange={(v) => setF({ ...f, outputWarehouseId: v })} />
      </Group>
      <Textarea label="Observaciones" autosize minRows={1} value={f.notes} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
      {product && f.formulaId && debouncedQty > 0 && (
        <>
          <Divider label="Verificar existencia" labelPosition="left" />
          <ExplosionTable productId={product.id} quantity={debouncedQty} formulaId={f.formulaId} />
        </>
      )}
    </FormModal>
  );
}
