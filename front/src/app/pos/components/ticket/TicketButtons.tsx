/**
 * @project FabriHub - Front
 * @file src/app/pos/components/ticket/TicketButtons.tsx
 * @description Imprimir el ticket térmico (registra la impresión: la primera es el original, las
 * siguientes salen «COPIA») y verlo antes de imprimir
 */

import { useState } from "react";
import { Button, Group, Modal } from "@mantine/core";
import { IconEye, IconPrinter } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@utils/notify";
import { posApi } from "../../services/pos.service";
import type { PosTicket } from "../../types";
import { printHtml, ticketHtml } from "./ticketHtml";

/** Registra una impresión en el servidor y abre la impresión del navegador */
export function usePrintTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleId: string) => {
      const t = await posApi.printTicket(saleId);
      await printHtml(ticketHtml(t, { isCopy: t.print?.isCopy }));
      return t;
    },
    onSuccess: (t, saleId) => qc.setQueryData(["pos", "ticket", saleId], t),
    onError: (err) => notifyError(err)
  });
}

function TicketPreview({ saleId, onClose }: Readonly<{ saleId: string | null; onClose: () => void }>) {
  const ticket = useQuery({ queryKey: ["pos", "ticket", saleId], queryFn: () => posApi.ticket(saleId!), enabled: Boolean(saleId) });
  const t: PosTicket | undefined = ticket.data;
  return (
    <Modal opened={Boolean(saleId)} onClose={onClose} title="Vista previa del ticket" size="auto" centered>
      {t && (
        <iframe
          title="Ticket"
          srcDoc={ticketHtml(t, { isCopy: t.printCount > 0, copies: 1 })}
          style={{ width: t.widthMm === 58 ? 260 : 340, height: 560, border: "1px solid var(--mantine-color-default-border)", background: "#fff" }}
        />
      )}
    </Modal>
  );
}

export default function TicketButtons({ saleId, size = "sm" }: Readonly<{ saleId: string; size?: string }>) {
  const print = usePrintTicket();
  const ticket = useQuery({ queryKey: ["pos", "ticket", saleId], queryFn: () => posApi.ticket(saleId) });
  const printed = (ticket.data?.printCount ?? 0) > 0;
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <>
      <Group gap="xs" wrap="nowrap">
        <Button size={size} leftSection={<IconPrinter size={16} />} loading={print.isPending} onClick={() => print.mutate(saleId)}>
          {printed ? "Reimprimir (copia)" : "Imprimir ticket"}
        </Button>
        <Button size={size} variant="default" leftSection={<IconEye size={16} />} onClick={() => setPreview(saleId)}>
          Ver
        </Button>
      </Group>
      <TicketPreview saleId={preview} onClose={() => setPreview(null)} />
    </>
  );
}
