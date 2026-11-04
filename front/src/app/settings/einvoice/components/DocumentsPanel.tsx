/**
 * @project FabriHub - Front
 * @file src/app/settings/einvoice/components/DocumentsPanel.tsx
 * @description Bitácora de comprobantes electrónicos: estado en Hacienda, detalle del rechazo,
 * reintento de envío y descarga del XML firmado o de la respuesta
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Paper, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDownload, IconRefresh, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { fmtBase } from "@utils/money";
import { notifyError, notifySuccess } from "@utils/notify";
import { EINV_STATUS, einvoiceApi, type EinvDocument } from "../einvoice.service";

const SITUATION: Record<EinvDocument["situation"], string> = { "1": "Normal", "2": "Contingencia", "3": "Sin internet" };

export default function DocumentsPanel() {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<string | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EinvDocument | null>(null);
  useEffect(() => setPage(1), [debounced, status, docType]);

  const list = useQuery({
    queryKey: ["einvoice", "documents", debounced, status, docType, page],
    queryFn: () => einvoiceApi.documents({ search: debounced || undefined, status, docType, page, pageSize: 25 }),
    placeholderData: (prev) => prev,
    // Mientras haya comprobantes en camino, se refresca solo
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === "pending" || d.status === "sent") ? 15_000 : false)
  });

  const columns = useMemo<ColumnDef<EinvDocument, unknown>[]>(
    () => [
      {
        header: "Comprobante",
        cell: ({ row: { original: d } }) => (
          <div>
            <Text size="sm" fw={600}>
              {d.docName}
            </Text>
            <Text size="xs" ff="monospace" c="dimmed">
              {d.consecutive}
            </Text>
          </div>
        )
      },
      {
        header: "Venta",
        cell: ({ row: { original: d } }) => (
          <div>
            <Text size="sm" ff="monospace">
              {d.ticketNumber}
            </Text>
            <Text size="xs" c="dimmed">
              {fmtDateTime(d.issuedAt)}
            </Text>
          </div>
        )
      },
      { header: "Cliente", cell: ({ row: { original: d } }) => <Text size="sm">{d.customerName}</Text> },
      { header: "Total", cell: ({ row: { original: d } }) => <Text size="sm">{fmtBase(d.total)}</Text> },
      {
        header: "Hacienda",
        size: 140,
        cell: ({ row: { original: d } }) => (
          <Stack gap={2}>
            <Badge color={EINV_STATUS[d.status].color} variant="light">
              {EINV_STATUS[d.status].label}
            </Badge>
            {d.lastError && d.status === "pending" && (
              <Text size="xs" c="red" lineClamp={1}>
                {d.lastError}
              </Text>
            )}
          </Stack>
        )
      }
    ],
    []
  );

  return (
    <Paper withBorder radius="lg" p="lg">
      <Title order={5} mb="md">
        Comprobantes emitidos
      </Title>
      <Group mb="md">
        <TextInput placeholder="Clave, consecutivo, venta o cliente" leftSection={<IconSearch size={16} />} w={300} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Select
          placeholder="Tipo"
          clearable
          w={200}
          data={[
            { value: "TE", label: "Tiquete electrónico" },
            { value: "FE", label: "Factura electrónica" },
            { value: "NC", label: "Nota de crédito" }
          ]}
          value={docType}
          onChange={setDocType}
        />
        <Select
          placeholder="Estado"
          clearable
          w={180}
          data={Object.entries(EINV_STATUS).map(([value, s]) => ({ value, label: s.label }))}
          value={status}
          onChange={setStatus}
        />
      </Group>
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        onRowClick={setOpen}
        rowKey={(d) => d.id}
        emptyText="Aún no se han emitido comprobantes"
      />
      <DocumentDrawer doc={open} onClose={() => setOpen(null)} onChange={setOpen} />
    </Paper>
  );
}

function DocumentDrawer({ doc, onClose, onChange }: Readonly<{ doc: EinvDocument | null; onClose: () => void; onChange: (d: EinvDocument) => void }>) {
  const qc = useQueryClient();
  const canRetry = useCan("POS_SALES")("approve");
  const retry = useMutation({
    mutationFn: (id: string) => einvoiceApi.retry(id),
    onSuccess: (d) => {
      onChange(d);
      notifySuccess(`Estado: ${EINV_STATUS[d.status].label}`);
      qc.invalidateQueries({ queryKey: ["einvoice"] });
    },
    onError: (err) => notifyError(err)
  });
  const download = (kind: "signed" | "response") => einvoiceApi.downloadXml(doc!.id, kind).catch((err) => notifyError(err, "No se pudo descargar el XML"));

  return (
    <Drawer opened={Boolean(doc)} onClose={onClose} position="right" size="lg" title={doc ? `${doc.docName} · ${doc.ticketNumber}` : ""}>
      {doc && (
        <Stack gap="sm">
          <Group gap="xs">
            <Badge color={EINV_STATUS[doc.status].color} variant="light" size="lg">
              {EINV_STATUS[doc.status].label}
            </Badge>
            <Badge variant="outline">{doc.environment === "prod" ? "Producción" : "Pruebas"}</Badge>
            <Badge variant="outline" color={doc.situation === "1" ? "gray" : "orange"}>
              Situación: {SITUATION[doc.situation]}
            </Badge>
          </Group>
          <Field label="Consecutivo" value={doc.consecutive} mono />
          <Field label="Clave" value={doc.clave} mono />
          {doc.referenceClave && <Field label="Anula el comprobante" value={`${doc.referenceConsecutive} · ${doc.reason ?? ""}`} mono />}
          <Field label="Cliente" value={`${doc.customerName} (${doc.customerTaxId})`} />
          <Field label="Total" value={fmtBase(doc.total)} />
          <Field label="Emitido" value={fmtDateTime(doc.issuedAt)} />
          {doc.sentAt && <Field label="Enviado a Hacienda" value={fmtDateTime(doc.sentAt)} />}
          {doc.decidedAt && <Field label="Respuesta de Hacienda" value={fmtDateTime(doc.decidedAt)} />}
          {doc.responseMessage && (
            <Alert color={doc.status === "rejected" ? "red" : "teal"} variant="light" title="Mensaje de Hacienda">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {doc.responseMessage}
              </Text>
            </Alert>
          )}
          {doc.lastError && (doc.status === "pending" || doc.status === "sent" || doc.status === "cancelled") && (
            <Alert color="orange" variant="light" title={`Último intento (${doc.attempts})`}>
              <Text size="sm">{doc.lastError}</Text>
              {doc.status !== "cancelled" && (
                <Text size="xs" c="dimmed" mt={4}>
                  Próximo intento automático: {fmtDateTime(doc.nextAttemptAt)}
                </Text>
              )}
            </Alert>
          )}
          <Group mt="sm">
            {(doc.status === "pending" || doc.status === "sent") && canRetry && (
              <Button leftSection={<IconRefresh size={16} />} loading={retry.isPending} onClick={() => retry.mutate(doc.id)}>
                {doc.status === "pending" ? "Enviar ahora" : "Consultar estado"}
              </Button>
            )}
            <Button variant="default" leftSection={<IconDownload size={16} />} disabled={!doc.hasXml} onClick={() => download("signed")}>
              XML firmado
            </Button>
            <Button variant="default" leftSection={<IconDownload size={16} />} disabled={!doc.hasResponse} onClick={() => download("response")}>
              Respuesta de Hacienda
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}

function Field({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ff={mono ? "monospace" : undefined} style={{ wordBreak: "break-all" }}>
        {value}
      </Text>
    </div>
  );
}
