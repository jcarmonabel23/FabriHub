/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/SaleDoneModal.tsx
 * @description Venta confirmada: número de comprobante, vuelto a entregar, ticket térmico (impreso solo
 * si la caja lo pide) y PDF
 */

import { useEffect, useRef } from "react";
import { Button, Group, Modal, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import PdfButton from "@atoms/actions/PdfButton";
import { fmtMoney } from "@utils/format";
import TicketButtons, { usePrintTicket } from "../../components/ticket/TicketButtons";
import { posApi } from "../../services/pos.service";
import type { PosSale } from "../../types";

export default function SaleDoneModal({ sale, onClose }: Readonly<{ sale: PosSale | null; onClose: () => void }>) {
  const ticket = useQuery({ queryKey: ["pos", "ticket", sale?.id], queryFn: () => posApi.ticket(sale!.id), enabled: Boolean(sale) });
  const print = usePrintTicket();
  const autoPrinted = useRef<string | null>(null);

  // Impresión automática (configurada en la caja): una sola vez por venta
  useEffect(() => {
    const t = ticket.data;
    if (!sale || !t || !t.autoPrint || t.printCount > 0 || autoPrinted.current === sale.id) return;
    autoPrinted.current = sale.id;
    print.mutate(sale.id);
  }, [sale, ticket.data, print]);

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
          <TicketButtons saleId={sale.id} />
          <Group mt="xs" grow w="100%">
            <PdfButton size="sm" path={`/pos/sales/${sale.id}/pdf`} label="PDF" />
            <Button data-autofocus onClick={onClose}>
              Nueva venta
            </Button>
          </Group>
          {ticket.data && (
            <Text size="xs" c="dimmed" ta="center">
              {ticket.data.legends.join(" ")}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
