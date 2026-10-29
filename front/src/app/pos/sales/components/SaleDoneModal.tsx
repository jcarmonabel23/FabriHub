/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/SaleDoneModal.tsx
 * @description Venta confirmada: número de comprobante, vuelto a entregar y descarga del PDF
 */

import { Button, Group, Modal, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import PdfButton from "@atoms/actions/PdfButton";
import { fmtMoney } from "@utils/format";
import type { PosSale } from "../../types";

export default function SaleDoneModal({ sale, onClose }: Readonly<{ sale: PosSale | null; onClose: () => void }>) {
  return (
    <Modal opened={Boolean(sale)} onClose={onClose} withCloseButton={false} centered size="sm">
      {sale && (
        <Stack align="center" gap="xs">
          <ThemeIcon size={56} radius="xl" color="teal">
            <IconCheck size={32} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            Venta registrada
          </Text>
          <Text ff="monospace">{sale.ticketNumber}</Text>
          <Text size="sm" c="dimmed">
            Total {sale.currencyCode} {fmtMoney(sale.grandTotal)} · {sale.customerName}
          </Text>
          {sale.changeAmount > 0 && (
            <div className="my-2 w-full rounded-lg bg-teal-50 p-3 text-center">
              <Text size="xs" tt="uppercase" c="teal.8">
                Vuelto a entregar
              </Text>
              <Text size="xl" fw={800} c="teal.8">
                {sale.changeCurrencyCode ?? sale.currencyCode} {fmtMoney(sale.changeInCurrency ?? sale.changeAmount)}
              </Text>
            </div>
          )}
          <Group mt="sm" grow w="100%">
            <PdfButton size="sm" path={`/pos/sales/${sale.id}/pdf`} label="Comprobante" />
            <Button data-autofocus onClick={onClose}>
              Nueva venta
            </Button>
          </Group>
          <Text size="xs" c="dimmed" ta="center">
            El comprobante no es una factura fiscal.
          </Text>
        </Stack>
      )}
    </Modal>
  );
}
