/**
 * @project FabriHub - Front
 * @file src/app/inventory/products/ProductFormModal.tsx
 * @description Alta/edición del producto (tesis: Clase Productos) en pestañas
 */

import { useEffect, useState } from "react";
import { Alert, Group, NumberInput, Select, SimpleGrid, Switch, Tabs, TagsInput, Text, TextInput, Textarea } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "@atoms/forms/FormModal";
import { settingsApi } from "@/app/settings/services/settings.service";
import { notifyError, notifySuccess } from "@utils/notify";
import { inventoryApi } from "../services/inventory.service";
import type { ProductRow } from "../types";

type Form = {
  code: string;
  name: string;
  description: string;
  productTypeId: string | null;
  familyId: string | null;
  categoryId: string | null;
  tags: string[];
  stockUnitId: string | null;
  purchaseUnitId: string | null;
  purchaseFactor: number | string;
  saleUnitId: string | null;
  saleFactor: number | string;
  productionUnitId: string | null;
  productionFactor: number | string;
  isStockable: boolean;
  isLotControlled: boolean;
  isPurchased: boolean;
  isSold: boolean;
  isManufactured: boolean;
  isOnHold: boolean;
  shelfLifeDays: number | string;
  fiscalTreatmentId: string | null;
  salePrice: number | string;
  purchasePrice: number | string;
  standardCost: number | string;
};

const empty: Form = {
  code: "",
  name: "",
  description: "",
  productTypeId: null,
  familyId: null,
  categoryId: null,
  tags: [],
  stockUnitId: null,
  purchaseUnitId: null,
  purchaseFactor: 1,
  saleUnitId: null,
  saleFactor: 1,
  productionUnitId: null,
  productionFactor: 1,
  isStockable: true,
  isLotControlled: false,
  isPurchased: false,
  isSold: false,
  isManufactured: false,
  isOnHold: false,
  shelfLifeDays: "",
  fiscalTreatmentId: null,
  salePrice: "",
  purchasePrice: "",
  standardCost: ""
};

const num = (v: number | string): number | null => (v === "" || v === null ? null : Number(v));

const useOptions = (catalog: string) =>
  useQuery({
    queryKey: ["lookup", catalog],
    queryFn: () => settingsApi.lookup(catalog),
    staleTime: 60_000,
    select: (rows) => rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}`, nature: r.nature as string | undefined }))
  });

export default function ProductFormModal({ opened, product, onClose }: Readonly<{ opened: boolean; product: ProductRow | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(empty);
  const types = useOptions("product-types");
  const families = useOptions("product-families");
  const categories = useOptions("product-categories");
  const units = useOptions("units");
  const treatments = useOptions("fiscal-treatments");

  useEffect(() => {
    if (!opened) return;
    if (!product) {
      setF(empty);
      return;
    }
    setF({
      ...empty,
      ...Object.fromEntries(Object.keys(empty).map((k) => [k, (product as unknown as Record<string, unknown>)[k] ?? (empty as Record<string, unknown>)[k]])),
      description: product.description ?? ""
    } as Form);
  }, [opened, product]);

  const isService = types.data?.find((t) => t.value === f.productTypeId)?.nature === "service";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name,
        description: f.description || null,
        productTypeId: f.productTypeId,
        familyId: f.familyId,
        categoryId: f.categoryId,
        tags: f.tags,
        stockUnitId: f.stockUnitId,
        purchaseUnitId: f.purchaseUnitId,
        purchaseFactor: Number(f.purchaseFactor) || 1,
        saleUnitId: f.saleUnitId,
        saleFactor: Number(f.saleFactor) || 1,
        productionUnitId: f.productionUnitId,
        productionFactor: Number(f.productionFactor) || 1,
        isStockable: isService ? false : f.isStockable,
        isLotControlled: isService ? false : f.isLotControlled,
        isPurchased: f.isPurchased,
        isSold: f.isSold,
        isManufactured: f.isManufactured,
        isOnHold: f.isOnHold,
        shelfLifeDays: num(f.shelfLifeDays),
        fiscalTreatmentId: f.fiscalTreatmentId,
        salePrice: num(f.salePrice),
        purchasePrice: num(f.purchasePrice),
        standardCost: num(f.standardCost)
      };
      return product ? inventoryApi.updateProduct(product.id, body) : inventoryApi.createProduct({ ...body, code: f.code });
    },
    onSuccess: () => {
      notifySuccess(product ? "Producto actualizado" : "Producto creado");
      qc.invalidateQueries({ queryKey: ["inventory", "products"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const valid = (Boolean(product) || /^[A-Za-z0-9._-]{1,30}$/.test(f.code)) && f.name.trim().length >= 2 && Boolean(f.productTypeId) && Boolean(f.stockUnitId);
  const hasHistory = Boolean(product && product.totalQuantity !== 0);
  const unitLabel = units.data?.find((u) => u.value === f.stockUnitId)?.label.split(" · ")[0] ?? "unidad de almacén";

  return (
    <FormModal opened={opened} onClose={onClose} size="xl" title={product ? `Editar ${product.code}` : "Nuevo producto"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid}>
      <Tabs defaultValue="general" keepMounted>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="units">Unidades</Tabs.Tab>
          <Tabs.Tab value="control">Control</Tabs.Tab>
          <Tabs.Tab value="prices">Precios y fiscal</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Código" required disabled={Boolean(product)} value={f.code} onChange={(e) => set("code", e.currentTarget.value.toUpperCase())} />
            <Select label="Tipo" required searchable data={types.data ?? []} value={f.productTypeId} onChange={(v) => set("productTypeId", v)} />
            <TextInput label="Nombre" required className="sm:col-span-2" value={f.name} onChange={(e) => set("name", e.currentTarget.value)} />
            <Select label="Familia" clearable searchable data={families.data ?? []} value={f.familyId} onChange={(v) => set("familyId", v)} />
            <Select label="Categoría" clearable searchable data={categories.data ?? []} value={f.categoryId} onChange={(v) => set("categoryId", v)} />
          </SimpleGrid>
          <TagsInput mt="sm" label="Etiquetas" description="Agrupaciones libres (tesis: Concepto 1 al 6)" maxTags={10} value={f.tags} onChange={(v) => set("tags", v)} />
          <Textarea mt="sm" label="Descripción" autosize minRows={2} value={f.description} onChange={(e) => set("description", e.currentTarget.value)} />
        </Tabs.Panel>

        <Tabs.Panel value="units">
          <Select
            label="Unidad de almacén"
            description={hasHistory ? "No se cambia: el producto ya tiene existencia" : "Todas las cantidades de inventario se expresan en ella"}
            required
            searchable
            disabled={hasHistory}
            data={units.data ?? []}
            value={f.stockUnitId}
            onChange={(v) => set("stockUnitId", v)}
          />
          {(
            [
              ["purchaseUnitId", "purchaseFactor", "Unidad de compra"],
              ["saleUnitId", "saleFactor", "Unidad de venta"],
              ["productionUnitId", "productionFactor", "Unidad de producción"]
            ] as const
          ).map(([unitKey, factorKey, label]) => (
            <Group key={unitKey} grow mt="sm" align="flex-end">
              <Select label={label} clearable searchable data={units.data ?? []} value={f[unitKey]} onChange={(v) => set(unitKey, v)} />
              <NumberInput
                label={`Equivale a (${unitLabel})`}
                min={0.000001}
                decimalScale={6}
                decimalSeparator=","
                thousandSeparator="."
                disabled={!f[unitKey]}
                value={f[factorKey]}
                onChange={(v) => set(factorKey, v)}
              />
            </Group>
          ))}
          <Text size="xs" c="dimmed" mt="sm">
            Ejemplo: se compra por MILLAR y se almacena por UND → factor 1.000.
          </Text>
        </Tabs.Panel>

        <Tabs.Panel value="control">
          {isService && (
            <Alert color="petrol" variant="light" icon={<IconInfoCircle size={18} />} mb="sm">
              Los servicios no son inventariables ni se manejan por lote.
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Switch label="Inventariable" description="Tangible: lleva existencia" checked={!isService && f.isStockable} disabled={isService || hasHistory} onChange={(e) => set("isStockable", e.currentTarget.checked)} />
            <Switch
              label="Manejado por lote"
              description={hasHistory ? "Fijo: ya tiene existencia" : "Trazabilidad y vencimiento por lote"}
              checked={!isService && f.isLotControlled}
              disabled={isService || hasHistory || !f.isStockable}
              onChange={(e) => set("isLotControlled", e.currentTarget.checked)}
            />
            <Switch label="Se compra" checked={f.isPurchased} onChange={(e) => set("isPurchased", e.currentTarget.checked)} />
            <Switch label="Se vende" checked={f.isSold} onChange={(e) => set("isSold", e.currentTarget.checked)} />
            <Switch label="Se fabrica" description="Tendrá fórmula y ruta (fase 5)" checked={f.isManufactured} onChange={(e) => set("isManufactured", e.currentTarget.checked)} />
            <Switch label="Retenido" description="Bloquea todos sus movimientos" color="red" checked={f.isOnHold} onChange={(e) => set("isOnHold", e.currentTarget.checked)} />
          </SimpleGrid>
          <NumberInput mt="md" maw={260} label="Vida útil (días)" description="Sugiere el vencimiento de lotes nuevos" min={1} allowDecimal={false} value={f.shelfLifeDays} onChange={(v) => set("shelfLifeDays", v)} />
        </Tabs.Panel>

        <Tabs.Panel value="prices">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput label="Precio de venta" min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={f.salePrice} onChange={(v) => set("salePrice", v)} />
            <NumberInput label="Precio de compra" min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={f.purchasePrice} onChange={(v) => set("purchasePrice", v)} />
            <NumberInput label="Costo estándar" min={0} decimalScale={6} decimalSeparator="," thousandSeparator="." value={f.standardCost} onChange={(v) => set("standardCost", v)} />
          </SimpleGrid>
          <Select mt="sm" label="Tratamiento fiscal" clearable searchable data={treatments.data ?? []} value={f.fiscalTreatmentId} onChange={(v) => set("fiscalTreatmentId", v)} />
          <Text size="xs" c="dimmed" mt="xs">
            Precios de referencia en la moneda base; las listas de precios por cliente y proveedor llegan con Compras y Ventas.
          </Text>
        </Tabs.Panel>
      </Tabs>
    </FormModal>
  );
}
