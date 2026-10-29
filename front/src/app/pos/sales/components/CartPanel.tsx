/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/CartPanel.tsx
 * @description Ticket en vivo: líneas, cantidades, descuentos, cliente y totales cotizados por el servidor
 *
 * Los importes vienen de la última cotización (POST /pos/sales/quote); mientras llega una nueva se
 * muestra la anterior atenuada. Un descuento sobre el límite se marca: al cobrar lo autoriza un supervisor.
 */

import { ActionIcon, Alert, Badge, Button, Divider, Group, Image, NumberInput, Popover, ScrollArea, Stack, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconCash, IconMinus, IconPackage, IconPercentage, IconPlus, IconShieldLock, IconTrash } from "@tabler/icons-react";
import { fmtMoney } from "@utils/format";
import { useCart } from "../../store/cart";
import type { Quote } from "../../types";
import CustomerPicker from "./CustomerPicker";

interface Props {
  quote: Quote | undefined;
  quoting: boolean;
  quoteError: string | null;
  maxDiscountPct: number;
  onPay: () => void;
}

export default function CartPanel({ quote, quoting, quoteError, maxDiscountPct, onPay }: Readonly<Props>) {
  const { lines, customer, discountPct, setQuantity, setLineDiscount, remove, setCustomer, setDiscount, clear } = useCart();
  const quoted = new Map((quote?.lines ?? []).map((l) => [l.productId, l]));
  const stale = quoting || !quote || quote.lines.length !== lines.length;
  const over = (pct: number) => pct > maxDiscountPct;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
      <div className="p-3">
        <CustomerPicker value={customer} applied={quote?.customer ?? null} onChange={setCustomer} />
      </div>
      <Divider />

      <ScrollArea className="min-h-0 flex-1" offsetScrollbars>
        <Stack gap={0}>
          {lines.map((l) => {
            const q = quoted.get(l.productId);
            const short = l.available !== null && l.quantity > l.available;
            return (
              <div key={l.productId} className="flex gap-2 border-b border-gray-100 px-3 py-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-50">
                  {l.thumb ? <Image src={l.thumb} alt="" w={40} h={40} fit="contain" /> : <IconPackage size={20} className="text-gray-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <Text size="sm" fw={600} lineClamp={1}>
                    {l.name}
                  </Text>
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">
                      {q ? `${fmtMoney(q.unitPrice)} / ${l.unitCode}` : l.code}
                    </Text>
                    {l.discountPct > 0 && (
                      <Badge size="xs" color={over(l.discountPct) ? "orange" : "gray"} variant="light">
                        -{l.discountPct}%
                      </Badge>
                    )}
                    {short && (
                      <Badge size="xs" color="red" variant="light">
                        Disponible {fmtMoney(l.available, 0)}
                      </Badge>
                    )}
                  </Group>
                  <Group gap={4} mt={4} wrap="nowrap">
                    <ActionIcon size="sm" variant="default" aria-label="Menos" onClick={() => setQuantity(l.productId, l.quantity - 1)}>
                      <IconMinus size={14} />
                    </ActionIcon>
                    <NumberInput
                      size="xs"
                      w={70}
                      min={0}
                      decimalSeparator=","
                      hideControls
                      value={l.quantity}
                      onChange={(v) => setQuantity(l.productId, Number(v) || 0)}
                      aria-label="Cantidad"
                    />
                    <ActionIcon size="sm" variant="default" aria-label="Más" onClick={() => setQuantity(l.productId, l.quantity + 1)}>
                      <IconPlus size={14} />
                    </ActionIcon>
                    <Popover position="bottom" withArrow shadow="md">
                      <Popover.Target>
                        <ActionIcon size="sm" variant="subtle" aria-label="Descuento de la línea">
                          <IconPercentage size={14} />
                        </ActionIcon>
                      </Popover.Target>
                      <Popover.Dropdown>
                        <NumberInput
                          label="Descuento de la línea (%)"
                          description={`Más de ${maxDiscountPct}% requiere supervisor`}
                          min={0}
                          max={100}
                          decimalScale={2}
                          decimalSeparator=","
                          value={l.discountPct}
                          onChange={(v) => setLineDiscount(l.productId, Math.min(100, Number(v) || 0))}
                        />
                      </Popover.Dropdown>
                    </Popover>
                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Quitar" onClick={() => remove(l.productId)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </div>
                <Text size="sm" fw={700} className={stale ? "opacity-50" : ""}>
                  {q ? fmtMoney(q.netAmount + q.taxAmount) : "…"}
                </Text>
              </div>
            );
          })}
          {!lines.length && (
            <Text c="dimmed" ta="center" py="xl" size="sm">
              Escanee o toque un producto para empezar
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Divider />
      <Stack gap={4} p="sm" className={stale && lines.length ? "opacity-60" : ""}>
        {quoteError && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">
            {quoteError}
          </Alert>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Descuento global
          </Text>
          <NumberInput
            size="xs"
            w={90}
            min={0}
            max={100}
            decimalScale={2}
            decimalSeparator=","
            suffix="%"
            value={discountPct}
            onChange={(v) => setDiscount(Math.min(100, Number(v) || 0))}
            error={over(discountPct)}
            aria-label="Descuento global"
          />
        </Group>
        <Row label="Subtotal" value={quote?.subtotal} />
        {Boolean(quote?.discountAmount) && <Row label="Descuento" value={-(quote?.discountAmount ?? 0)} />}
        {(quote?.taxes ?? [])
          .filter((t) => t.rate > 0)
          .map((t) => (
            <Row key={t.rate} label={`IVA ${t.rate}% (base ${fmtMoney(t.base)})`} value={t.amount} />
          ))}
        <Group justify="space-between" mt={4}>
          <Text fw={700} size="lg">
            Total
          </Text>
          <Text fw={800} size="xl">
            {quote && lines.length ? fmtMoney(quote.total) : fmtMoney(0)}
          </Text>
        </Group>
        {quote?.needsSupervisor && (
          <Group gap={4}>
            <IconShieldLock size={14} className="text-amber-700" />
            <Text size="xs" c="orange.9">
              Descuento mayor a {maxDiscountPct}%: lo autoriza un supervisor al cobrar
            </Text>
          </Group>
        )}
        <Group grow mt="xs">
          <Tooltip label="Vaciar la cuenta">
            <Button variant="default" color="gray" disabled={!lines.length} onClick={clear} style={{ flexGrow: 0 }}>
              <IconTrash size={18} />
            </Button>
          </Tooltip>
          <Button size="md" leftSection={<IconCash size={20} />} disabled={!lines.length || !quote || stale || Boolean(quoteError)} onClick={onPay}>
            Cobrar (F9)
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

function Row({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{fmtMoney(value ?? 0)}</Text>
    </Group>
  );
}
