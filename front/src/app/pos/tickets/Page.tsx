/**
 * @project FabriHub - Front
 * @file src/app/pos/tickets/Page.tsx
 * @description Punto de venta → Comprobantes (POS_SALES view): consulta, PDF y anulación
 *
 * Sin view_all cada cajero ve solo sus ventas. Anular exige un supervisor (o serlo) y solo se puede
 * mientras el turno de la venta sigue abierto: la mercancía vuelve al almacén.
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Select, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBan, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "react-router-dom";
import PdfButton from "@atoms/actions/PdfButton";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ApiError } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import SupervisorFields, { SUPERVISOR_ERRORS, supervisorReady } from "../components/SupervisorFields";
import { POS_ACTIONS } from "../posActions";
import { posApi } from "../services/pos.service";
import { PAYMENT_METHOD_LABEL, type PaymentMethod, type PosSale, type PosSaleRow, type SupervisorInput } from "../types";

const methodsLabel = (m: string | null) => (m ? m.split(",").map((x) => PAYMENT_METHOD_LABEL[x as PaymentMethod] ?? x).join(", ") : "—");

function VoidModal({ sale, onClose }: Readonly<{ sale: PosSale | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const isSupervisor = useCan("POS_SALES")("approve");
  const [reason, setReason] = useState("");
  const [sup, setSup] = useState<SupervisorInput>({ userId: "", pin: "" });
  const [supError, setSupError] = useState<string | null>(null);
  useEffect(() => {
    if (sale) {
      setReason("");
      setSup({ userId: "", pin: "" });
      setSupError(null);
    }
  }, [sale]);
  const run = useMutation({
    mutationFn: () => posApi.voidSale(sale!.id, reason.trim(), isSupervisor ? null : sup),
    onSuccess: (v) => {
      notifySuccess(`Venta ${v.ticketNumber} anulada: la mercancía volvió al almacén`);
      qc.invalidateQueries({ queryKey: ["pos"] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && SUPERVISOR_ERRORS.includes(err.code)) setSupError(err.message);
      else notifyError(err);
    }
  });
  return (
    <FormModal
      opened={Boolean(sale)}
      onClose={onClose}
      title={`Anular ${sale?.ticketNumber ?? ""}`}
      onSubmit={() => run.mutate()}
      loading={run.isPending}
      valid={reason.trim().length >= 3 && (isSupervisor || supervisorReady(sup))}
      submitLabel="Anular venta"
    >
      <Text size="sm" c="dimmed">
        Se reversa la salida de inventario y la venta deja de contar en el arqueo del turno. No se puede deshacer.
      </Text>
      <Textarea label="Motivo" required autosize minRows={2} maxLength={400} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      {!isSupervisor && (
        <SupervisorFields
          reason="Anular requiere un supervisor"
          value={sup}
          onChange={(v) => {
            setSup(v);
            setSupError(null);
          }}
          error={supError}
        />
      )}
    </FormModal>
  );
}

function SaleDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const can = useCan("POS_SALES");
  const detail = useQuery({ queryKey: ["pos", "sale", id], queryFn: () => posApi.getSale(id!), enabled: Boolean(id) });
  const [voiding, setVoiding] = useState<PosSale | null>(null);
  const s = detail.data;
  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="xl" title={s ? `Comprobante ${s.ticketNumber}` : "Comprobante"}>
      {s && (
        <Stack>
          <Group justify="space-between">
            <div>
              <Text fw={700}>{s.customerName}</Text>
              <Text size="sm" c="dimmed">
                {s.customerRif} · {fmtDateTime(s.soldAt)} · caja {s.terminalCode} · turno {s.sessionNumber} · {s.cashierName}
              </Text>
            </div>
            <Badge color={s.status === "voided" ? "red" : "teal"} size="lg">
              {s.status === "voided" ? "Anulada" : "Completada"}
            </Badge>
          </Group>
          {s.status === "voided" && (
            <Alert color="red" variant="light">
              Anulada el {fmtDateTime(s.voidedAt)} por {s.voidedByName}
              {s.voidAuthorizedBy && s.voidAuthorizedBy !== s.voidedByName ? ` (autorizó ${s.voidAuthorizedBy})` : ""}: {s.voidReason}
            </Alert>
          )}
          <Table withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Producto</Table.Th>
                <Table.Th ta="right">Cant.</Table.Th>
                <Table.Th ta="right">Precio</Table.Th>
                <Table.Th ta="right">Desc.</Table.Th>
                <Table.Th ta="right">IVA</Table.Th>
                <Table.Th ta="right">Neto</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.lines.map((l) => (
                <Table.Tr key={l.lineNo}>
                  <Table.Td>
                    <Text size="sm">{l.productName}</Text>
                    <Text size="xs" c="dimmed">
                      {l.productCode}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    {fmtMoney(l.quantity, 2)} {l.unitCode}
                  </Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.unitPrice)}</Table.Td>
                  <Table.Td ta="right">{l.discountPct ? `${l.discountPct}%` : "—"}</Table.Td>
                  <Table.Td ta="right">{l.taxRate ? `${l.taxRate}%` : "Ex."}</Table.Td>
                  <Table.Td ta="right">{fmtMoney(l.netAmount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Stack gap={2} maw={340} ml="auto" w="100%">
            <Line label="Subtotal" value={s.subtotal} />
            {s.discountAmount > 0 && <Line label={`Descuento${s.discountAuthorizedBy ? ` (autorizó ${s.discountAuthorizedBy})` : ""}`} value={-s.discountAmount} />}
            {(s.taxesDetail?.taxes ?? []).filter((t) => t.rate > 0).map((t) => <Line key={t.rate} label={`IVA ${t.rate}%`} value={t.amount} />)}
            {s.igtfAmount > 0 && <Line label={`IGTF ${s.igtfRate}%`} value={s.igtfAmount} />}
            <Line label={`Total (${s.currencyCode})`} value={s.grandTotal} strong />
          </Stack>
          <Table fz="sm" withTableBorder>
            <Table.Tbody>
              {s.payments.map((p) => (
                <Table.Tr key={p.lineNo}>
                  <Table.Td>{PAYMENT_METHOD_LABEL[p.method]}</Table.Td>
                  <Table.Td>
                    {p.currencyCode} {fmtMoney(p.amount)}
                  </Table.Td>
                  <Table.Td c="dimmed">{p.exchangeRate !== 1 ? `tasa ${fmtMoney(p.exchangeRate, 4)} = ${fmtMoney(p.amountBase)}` : ""}</Table.Td>
                  <Table.Td c="dimmed">{p.reference ? `ref. ${p.reference}` : ""}</Table.Td>
                </Table.Tr>
              ))}
              {s.changeAmount > 0 && (
                <Table.Tr>
                  <Table.Td>Vuelto</Table.Td>
                  <Table.Td>
                    {s.changeCurrencyCode} {fmtMoney(s.changeInCurrency ?? s.changeAmount)}
                  </Table.Td>
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
          {s.movementNumber && (
            <Text size="xs" c="dimmed">
              Salida de inventario {s.movementNumber} · almacén {s.warehouseCode}
            </Text>
          )}
          <Group justify="flex-end">
            <PdfButton size="sm" path={`/pos/sales/${s.id}/pdf`} label="Comprobante PDF" />
            {s.status === "completed" && can("add_new") && (
              <Button size="sm" color="red" variant="light" leftSection={<IconBan size={16} />} onClick={() => setVoiding(s)}>
                Anular
              </Button>
            )}
          </Group>
        </Stack>
      )}
      <VoidModal sale={voiding} onClose={() => setVoiding(null)} />
    </Drawer>
  );
}

function Line({ label, value, strong }: Readonly<{ label: string; value: number; strong?: boolean }>) {
  return (
    <Group justify="space-between">
      <Text size="sm" fw={strong ? 700 : 400}>
        {label}
      </Text>
      <Text size="sm" fw={strong ? 700 : 400}>
        {fmtMoney(value)}
      </Text>
    </Group>
  );
}

export default function PosTicketsPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session");
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setPage(1), [debounced, status, sessionId]);

  const list = useQuery({
    queryKey: ["pos", "sales", debounced, status, sessionId, page],
    queryFn: () => posApi.listSales({ search: debounced || undefined, status: status ?? undefined, sessionId: sessionId ?? undefined, page, pageSize: 25 }),
    placeholderData: (prev) => prev
  });

  const columns = useMemo<ColumnDef<PosSaleRow, unknown>[]>(
    () => [
      {
        header: "Comprobante",
        cell: ({ row: { original: s } }) => (
          <div>
            <Text size="sm" fw={700} ff="monospace">
              {s.ticketNumber}
            </Text>
            <Text size="xs" c="dimmed">
              {fmtDateTime(s.soldAt)}
            </Text>
          </div>
        )
      },
      {
        header: "Cliente",
        cell: ({ row: { original: s } }) => (
          <div>
            <Text size="sm">{s.customerName}</Text>
            <Text size="xs" c="dimmed">
              {s.customerRif}
            </Text>
          </div>
        )
      },
      { header: "Caja / turno", cell: ({ row: { original: s } }) => <Text size="sm">{`${s.terminalCode} · ${s.sessionNumber}`}</Text> },
      { header: "Cajero", cell: ({ row: { original: s } }) => <Text size="sm">{s.cashierName ?? "—"}</Text> },
      { header: "Pagos", cell: ({ row: { original: s } }) => <Text size="sm">{methodsLabel(s.methods)}</Text> },
      { header: "Total", cell: ({ row: { original: s } }) => <Text size="sm" fw={700} td={s.status === "voided" ? "line-through" : undefined}>{fmtMoney(s.grandTotal)}</Text> },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: s } }) => (
          <Badge color={s.status === "voided" ? "red" : "teal"} variant="light">
            {s.status === "voided" ? "Anulada" : "Completada"}
          </Badge>
        )
      }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Comprobantes" description={sessionId ? "Ventas del turno seleccionado" : "Ventas de mostrador: consulta, PDF y anulación"} actions={POS_ACTIONS} />
      <Group mb="md">
        <TextInput placeholder="Comprobante, cliente o RIF" leftSection={<IconSearch size={16} />} w={320} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Select
          placeholder="Estado"
          clearable
          w={180}
          data={[
            { value: "completed", label: "Completadas" },
            { value: "voided", label: "Anuladas" }
          ]}
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
        onRowClick={(s) => setOpenId(s.id)}
        rowKey={(s) => s.id}
        emptyText="Sin ventas"
      />
      <SaleDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
