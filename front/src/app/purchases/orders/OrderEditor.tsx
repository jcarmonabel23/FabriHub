/**
 * @project FabriHub - Front
 * @file src/app/purchases/orders/OrderEditor.tsx
 * @description Alta/edición de la orden en borrador. Los totales los calcula la API (POST /preview)
 * con el MISMO motor fiscal que guarda el documento: lo que se ve es lo que se aprobará.
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Divider, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertCircle, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ApiError } from "@clients/apiClient";
import { settingsApi } from "@/app/settings/services/settings.service";
import ProductSelect from "@/app/inventory/components/ProductSelect";
import type { ProductOption } from "@/app/inventory/types";
import { fmtMoney, fmtPct } from "@utils/format";
import { notifySuccess } from "@utils/notify";
import { purchasesApi } from "../services/purchases.service";
import type { OrderDetail } from "../types";

interface Line {
  key: number;
  product: ProductOption | null;
  unitId: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discountPct: number | string;
}

let seq = 0;
const blank = (): Line => ({ key: ++seq, product: null, unitId: null, quantity: "", unitPrice: "", discountPct: 0 });

const SOURCE_LABEL: Record<string, string> = { promo: "promoción", list: "lista", product: "referencia", manual: "manual" };

export default function OrderEditor({ opened, order, onClose, onSaved }: Readonly<{ opened: boolean; order: OrderDetail | null; onClose: () => void; onSaved: (o: OrderDetail) => void }>) {
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ["lookup", "suppliers"], queryFn: () => settingsApi.lookup("suppliers"), enabled: opened });
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: opened });
  const currencies = useQuery({ queryKey: ["lookup", "currencies"], queryFn: () => settingsApi.lookup("currencies"), enabled: opened });

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [expectedDate, setExpectedDate] = useState<string | null>(null);
  const [discountPct, setDiscountPct] = useState<number | string>(0);
  const [supplierReference, setSupplierReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    if (!order) {
      setSupplierId(null);
      setWarehouseId(null);
      setCurrencyId(null);
      setOrderDate(dayjs().format("YYYY-MM-DD"));
      setExpectedDate(null);
      setDiscountPct(0);
      setSupplierReference("");
      setNotes("");
      setLines([blank()]);
      return;
    }
    setSupplierId(order.supplierId);
    setWarehouseId(order.warehouseId);
    setCurrencyId(order.currencyId);
    setOrderDate(order.orderDate);
    setExpectedDate(order.expectedDate);
    setDiscountPct(order.discountPct);
    setSupplierReference(order.supplierReference ?? "");
    setNotes(order.notes ?? "");
    setLines(
      order.lines.map((l) => ({
        key: ++seq,
        product: { id: l.productId, code: l.productCode, name: l.productName, unitCode: l.stockUnitCode, unitDecimals: 2, isLotControlled: l.isLotControlled, isStockable: l.isStockable, shelfLifeDays: l.shelfLifeDays, isOnHold: false },
        unitId: l.unitId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct
      }))
    );
  }, [opened, order]);

  const complete = useMemo(() => lines.filter((l) => l.product && Number(l.quantity) > 0), [lines]);
  const body = useMemo(
    () => ({
      supplierId,
      warehouseId,
      currencyId,
      orderDate,
      expectedDate,
      discountPct: Number(discountPct) || 0,
      supplierReference: supplierReference || null,
      notes: notes || null,
      lines: complete.map((l) => ({
        productId: l.product!.id,
        unitId: l.unitId,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice === "" ? null : Number(l.unitPrice),
        discountPct: Number(l.discountPct) || 0
      }))
    }),
    [supplierId, warehouseId, currencyId, orderDate, expectedDate, discountPct, supplierReference, notes, complete]
  );
  const [debouncedBody] = useDebouncedValue(body, 500);
  const canPreview = Boolean(debouncedBody.supplierId && debouncedBody.warehouseId && debouncedBody.orderDate && debouncedBody.lines.length > 0);
  const preview = useQuery({
    queryKey: ["purchases", "preview", debouncedBody],
    queryFn: () => purchasesApi.preview(debouncedBody),
    enabled: opened && canPreview,
    retry: false
  });

  const save = useMutation({
    mutationFn: () => (order ? purchasesApi.updateOrder(order.id, body) : purchasesApi.createOrder(body)),
    onSuccess: (o) => {
      notifySuccess(order ? `Orden ${o.number} actualizada` : `Orden ${o.number} creada en borrador`);
      qc.invalidateQueries({ queryKey: ["purchases", "orders"] });
      onSaved(o);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo guardar")
  });

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const t = preview.data?.totals;
  const previewError = preview.error instanceof ApiError ? preview.error.message : null;
  const valid = canPreview && complete.length === lines.length && !previewError;
  const cur = currencies.data?.find((c) => c.id === (currencyId ?? preview.data?.currencyId));

  return (
    <Modal opened={opened} onClose={onClose} title={order ? `Editar ${order.number}` : "Nueva orden de compra"} size="90rem">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <Select label="Proveedor" required searchable data={(suppliers.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} value={supplierId} onChange={setSupplierId} />
          <Select label="Almacén de recepción" required data={(warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} value={warehouseId} onChange={setWarehouseId} />
          <Select
            label="Moneda"
            placeholder="La del proveedor"
            clearable
            data={(currencies.data ?? []).map((c) => ({ value: c.id, label: c.code }))}
            value={currencyId}
            onChange={setCurrencyId}
          />
          <Group grow>
            <DateInput label="Fecha" required valueFormat="DD/MM/YYYY" value={orderDate} onChange={setOrderDate} />
            <DateInput label="Se espera" clearable valueFormat="DD/MM/YYYY" value={expectedDate} minDate={orderDate ?? undefined} onChange={setExpectedDate} />
          </Group>
        </SimpleGrid>

        <Paper withBorder radius="md" className="overflow-x-auto">
          <Table verticalSpacing="xs" miw={1100}>
            <Table.Thead className="bg-gray-50">
              <Table.Tr>
                <Table.Th w={36}>#</Table.Th>
                <Table.Th w={330}>Producto</Table.Th>
                <Table.Th w={120}>Unidad</Table.Th>
                <Table.Th w={120}>Cantidad</Table.Th>
                <Table.Th w={150}>Precio unitario</Table.Th>
                <Table.Th w={90}>Desc. %</Table.Th>
                <Table.Th w={70} ta="right">IVA</Table.Th>
                <Table.Th w={130} ta="right">Neto</Table.Th>
                <Table.Th w={36} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => {
                const pl = preview.data && l.product ? preview.data.lines[complete.findIndex((c) => c.key === l.key)] : undefined;
                const units = l.product
                  ? [
                      ...(l.product.purchaseUnitId ? [{ value: l.product.purchaseUnitId, label: `${l.product.purchaseUnitCode} (×${l.product.purchaseFactor})` }] : []),
                      ...(l.product.stockUnitId && l.product.stockUnitId !== l.product.purchaseUnitId ? [{ value: l.product.stockUnitId, label: l.product.unitCode }] : [])
                    ]
                  : [];
                return (
                  <Table.Tr key={l.key}>
                    <Table.Td>{i + 1}</Table.Td>
                    <Table.Td>
                      <ProductSelect size="xs" only="purchased" value={l.product} onChange={(p) => setLine(l.key, { product: p, unitId: p?.purchaseUnitId ?? p?.stockUnitId ?? null, unitPrice: "" })} />
                    </Table.Td>
                    <Table.Td>
                      {units.length > 0 ? (
                        <Select size="xs" data={units} value={l.unitId} onChange={(v) => setLine(l.key, { unitId: v, unitPrice: "" })} />
                      ) : (
                        <Text size="xs" c="dimmed">
                          {l.product?.unitCode ?? ""}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput size="xs" min={0} decimalScale={4} decimalSeparator="," thousandSeparator="." value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={0}
                        decimalScale={4}
                        decimalSeparator=","
                        thousandSeparator="."
                        placeholder={pl ? fmtMoney(pl.unitPrice, 4) : "Automático"}
                        value={l.unitPrice}
                        onChange={(v) => setLine(l.key, { unitPrice: v })}
                      />
                      {pl?.priceSource && l.unitPrice === "" && (
                        <Text size="xs" c="dimmed">
                          Precio de {SOURCE_LABEL[pl.priceSource] ?? pl.priceSource}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput size="xs" min={0} max={100} decimalScale={2} decimalSeparator="," value={l.discountPct} onChange={(v) => setLine(l.key, { discountPct: v })} />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{pl ? fmtPct(pl.taxRate) : ""}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600}>
                        {pl ? fmtMoney(pl.net) : ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" aria-label="Quitar" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
        <Button variant="subtle" size="xs" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setLines([...lines, blank()])}>
          Agregar línea
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
          <Stack gap="sm">
            <Group grow>
              <NumberInput label="Descuento global %" min={0} max={100} decimalScale={2} decimalSeparator="," value={discountPct} onChange={setDiscountPct} />
              <TextInput label="Referencia del proveedor" placeholder="Nº de cotización" value={supplierReference} onChange={(e) => setSupplierReference(e.currentTarget.value)} />
            </Group>
            <Textarea label="Observaciones" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          </Stack>
          <Paper withBorder radius="md" p="md" className="bg-gray-50">
            {!t ? (
              <Text size="sm" c="dimmed">
                {previewError ?? "Complete proveedor, almacén y líneas para ver los totales."}
              </Text>
            ) : (
              <Stack gap={4}>
                {preview.data!.exchangeRate !== 1 && (
                  <Text size="xs" c="dimmed">
                    Tasa del {dayjs(orderDate).format("DD/MM/YYYY")}: {fmtMoney(preview.data!.exchangeRate, 4)}
                  </Text>
                )}
                <Group justify="space-between">
                  <Text size="sm">Subtotal</Text>
                  <Text size="sm">{fmtMoney(t.subtotal)}</Text>
                </Group>
                {t.discountAmount > 0 && (
                  <Group justify="space-between">
                    <Text size="sm">Descuento</Text>
                    <Text size="sm">− {fmtMoney(t.discountAmount)}</Text>
                  </Group>
                )}
                {t.taxes.map((x) => (
                  <Group key={x.rate} justify="space-between">
                    <Text size="sm">
                      IVA {fmtPct(x.rate)} sobre {fmtMoney(x.base)}
                    </Text>
                    <Text size="sm">{fmtMoney(x.amount)}</Text>
                  </Group>
                ))}
                <Divider my={4} />
                <Group justify="space-between">
                  <Text fw={700}>Total {cur?.code}</Text>
                  <Text fw={800} ff="monospace">
                    {fmtMoney(t.total)}
                  </Text>
                </Group>
                {t.withholdings.map((w) => (
                  <Group key={w.rateId} justify="space-between">
                    <Text size="sm" c="red">
                      {w.label}
                    </Text>
                    <Text size="sm" c="red">
                      − {fmtMoney(w.amount)}
                    </Text>
                  </Group>
                ))}
                {t.withholdings.length > 0 && (
                  <Group justify="space-between">
                    <Text fw={700}>Neto a pagar</Text>
                    <Text fw={800} ff="monospace">
                      {fmtMoney(t.payable)}
                    </Text>
                  </Group>
                )}
              </Stack>
            )}
          </Paper>
        </div>

        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        <Group justify="space-between">
          <Badge variant="light" color="gray">
            Se guarda como borrador; luego se envía a aprobación
          </Badge>
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
              Guardar borrador
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
