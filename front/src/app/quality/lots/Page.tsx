/**
 * @project FabriHub - Front
 * @file src/app/quality/lots/Page.tsx
 * @description Calidad → Liberación de lotes (QC_LOTS): cola de cuarentena y registro de decisiones
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Loader, Modal, SegmentedControl, Stack, Table, Text, TextInput, Textarea, Timeline, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCheck, IconInfoCircle, IconSearch, IconX } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { coreAuth } from "@auth/store/coreAuth";
import { QUALITY_COLOR, QUALITY_LABEL, type QualityStatus } from "@/app/inventory/types";
import { purchasesApi } from "@/app/purchases/services/purchases.service";
import type { QualityLot } from "@/app/purchases/types";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";

const MODULE = "QC_LOTS";
const PAGE_SIZE = 25;
const fmtD = (d: string | null) => (d ? dayjs(d).format("DD/MM/YYYY") : "—");

function DecisionModal({ target, onClose }: Readonly<{ target: { lot: QualityLot; decision: "approve" | "reject" } | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [analysisRef, setAnalysisRef] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    setAnalysisRef("");
    setNotes("");
  }, [target]);
  const approve = target?.decision === "approve";
  const save = useMutation({
    mutationFn: () => purchasesApi.decide(target!.lot.id, target!.decision, { notes, analysisRef: analysisRef || null }),
    onSuccess: () => {
      notifySuccess(approve ? `Lote ${target!.lot.lotCode} liberado` : `Lote ${target!.lot.lotCode} rechazado`);
      qc.invalidateQueries({ queryKey: ["quality"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <Modal opened={Boolean(target)} onClose={onClose} title={`${approve ? "Aprobar" : "Rechazar"} lote ${target?.lot.lotCode ?? ""}`}>
      <Stack>
        <Text size="sm">
          {target?.lot.productCode} · {target?.lot.productName} · {fmtMoney(target?.lot.quantity ?? 0, 2)} {target?.lot.unitCode}
        </Text>
        {!approve && (
          <Alert variant="light" color="red">
            Un lote rechazado no se puede usar; solo se devuelve al proveedor o se destruye (Merma).
          </Alert>
        )}
        <TextInput label="Referencia del análisis / certificado" placeholder="CA-2026-001" value={analysisRef} onChange={(e) => setAnalysisRef(e.currentTarget.value)} />
        <Textarea label="Fundamento" required autosize minRows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Text size="xs" c="dimmed">
          La decisión queda registrada con su nombre y no se puede modificar.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button color={approve ? "teal" : "red"} loading={save.isPending} disabled={notes.trim().length < 3} onClick={() => save.mutate()}>
            {approve ? "Aprobar" : "Rechazar"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function LotDrawer({ id, onClose }: Readonly<{ id: string | null; onClose: () => void }>) {
  const detail = useQuery({ queryKey: ["quality", "lot", id], queryFn: () => purchasesApi.qualityLot(id!), enabled: Boolean(id) });
  const l = detail.data;
  return (
    <Drawer opened={Boolean(id)} onClose={onClose} position="right" size="lg" title="Lote">
      {!l ? (
        <Loader size="sm" />
      ) : (
        <Stack>
          <Title order={4}>
            {l.lotCode} <Badge color={QUALITY_COLOR[l.qualityStatus as QualityStatus]}>{QUALITY_LABEL[l.qualityStatus as QualityStatus]}</Badge>
          </Title>
          <Text>
            {l.productCode} · {l.productName}
          </Text>
          <Table variant="vertical" withTableBorder fz="sm">
            <Table.Tbody>
              {(
                [
                  ["Origen", [l.originConcept, l.movementNumber].filter(Boolean).join(" · ")],
                  ["Proveedor", l.supplierName],
                  ["Orden de compra", l.orderNumber],
                  ["Lote del proveedor", l.supplierLot],
                  ["Recibido", `${fmtD(l.receivedOn)} por ${l.createdBy ?? "—"}`],
                  ["Vence", fmtD(l.expiresOn)],
                  ["Existencia", `${fmtMoney(l.quantity, 2)} ${l.unitCode}`]
                ] as const
              ).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Th w={170}>{k}</Table.Th>
                  <Table.Td>{v || "—"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Title order={6} tt="uppercase" c="petrol.8">
            Decisiones
          </Title>
          {l.events.length === 0 ? (
            <Text size="sm" c="dimmed">
              Sin decisiones todavía.
            </Text>
          ) : (
            <Timeline bulletSize={20} lineWidth={2}>
              {l.events.map((e) => (
                <Timeline.Item key={e.id} bullet={e.toStatus === "approved" ? <IconCheck size={12} /> : <IconX size={12} />} color={e.toStatus === "approved" ? "teal" : "red"} title={QUALITY_LABEL[e.toStatus as QualityStatus]}>
                  <Text size="sm">{e.notes}</Text>
                  <Text size="xs" c="dimmed">
                    {e.decidedBy} · {fmtDateTime(e.decidedAt)}
                    {e.analysisRef ? ` · ${e.analysisRef}` : ""}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

export default function QualityLotsPage() {
  const can = useCan(MODULE);
  const me = coreAuth((s) => s.user?.id);
  const [status, setStatus] = useState("quarantine");
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ lot: QualityLot; decision: "approve" | "reject" } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["quality", "lots", { status, debounced, page }],
    queryFn: () => purchasesApi.qualityLots({ status, search: debounced, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData
  });

  const columns = useMemo<ColumnDef<QualityLot, unknown>[]>(
    () => [
      {
        header: "Lote",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm" fw={700}>
              {l.lotCode}
            </Text>
            <Text size="xs" c="dimmed">
              #{l.internalNumber}
              {l.supplierLot ? ` · prov. ${l.supplierLot}` : ""}
            </Text>
          </div>
        )
      },
      {
        header: "Producto",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm">{l.productCode}</Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {l.productName}
            </Text>
          </div>
        )
      },
      {
        header: "Origen",
        cell: ({ row: { original: l } }) => (
          <div>
            <Text size="sm">{l.supplierName ?? l.originConcept ?? "—"}</Text>
            <Text size="xs" c="dimmed">
              {l.orderNumber ?? l.movementNumber ?? ""} · {fmtD(l.receivedOn)} · {l.createdBy ?? "—"}
            </Text>
          </div>
        )
      },
      { header: "Cantidad", cell: ({ row: { original: l } }) => <Text size="sm" fw={600}>{fmtMoney(l.quantity, 2)} {l.unitCode}</Text> },
      {
        id: "decision",
        header: status === "quarantine" ? "" : "Decisión",
        cell: ({ row: { original: l } }) =>
          status === "quarantine" ? (
            can("approve") && (
              <Group gap={4} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                <Button size="xs" color="teal" variant="light" disabled={l.createdById === me} onClick={() => setDecision({ lot: l, decision: "approve" })}>
                  Aprobar
                </Button>
                <Button size="xs" color="red" variant="subtle" disabled={l.createdById === me} onClick={() => setDecision({ lot: l, decision: "reject" })}>
                  Rechazar
                </Button>
              </Group>
            )
          ) : (
            l.lastDecision && (
              <div>
                <Badge color={l.lastDecision.toStatus === "approved" ? "teal" : "red"}>{QUALITY_LABEL[l.lastDecision.toStatus as QualityStatus]}</Badge>
                <Text size="xs" c="dimmed">
                  {l.lastDecision.decidedBy} · {fmtDateTime(l.lastDecision.decidedAt)}
                </Text>
              </div>
            )
          )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, can, me]
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Liberación de lotes" description="Ningún lote en cuarentena se usa hasta que Calidad lo apruebe" />
      <Group mb="md" gap="sm">
        <SegmentedControl
          data={[
            { value: "quarantine", label: "En cuarentena" },
            { value: "decided", label: "Decisiones" },
            { value: "rejected", label: "Rechazados" }
          ]}
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
        />
        <TextInput placeholder="Lote, producto o proveedor" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} w={280} />
      </Group>
      {status === "quarantine" && (
        <Alert variant="light" color="petrol" icon={<IconInfoCircle size={18} />} mb="md">
          Los botones aparecen deshabilitados en los lotes que usted mismo recibió o fabricó (segregación de funciones).
        </Alert>
      )}
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        rowKey={(l) => l.id}
        onRowClick={(l) => setDetailId(l.id)}
        emptyText={status === "quarantine" ? "No hay lotes esperando liberación" : "Sin registros"}
      />
      <DecisionModal target={decision} onClose={() => setDecision(null)} />
      <LotDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
