/**
 * @project FabriHub - Front
 * @file src/app/pos/terminals/Page.tsx
 * @description Punto de venta → Cajas (POS_TERMINALS): almacén, lista de precios, cliente por defecto y correlativo
 *
 * Cada caja despacha de un almacén y numera sus comprobantes con su propio prefijo. Una caja que
 * ya tuvo turnos no se elimina (se desactiva) y su prefijo no cambia una vez que emitió comprobantes.
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, NumberInput, PasswordInput, Select, Switch, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { IconInfoCircle, IconKey, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "@/app/settings/services/settings.service";
import { POS_ACTIONS } from "../posActions";
import { posApi } from "../services/pos.service";
import type { PosTerminal, PosTerminalInput } from "../types";

const MODULE = "POS_TERMINALS";
const CODE_RE = /^[A-Z0-9_-]{1,20}$/;
const PREFIX_RE = /^[A-Z0-9-]{0,10}$/;

const EMPTY: PosTerminalInput = {
  code: "",
  name: "",
  warehouseId: "",
  priceListId: null,
  defaultCustomerId: null,
  ticketPrefix: "",
  ticketPadding: 8,
  notes: null,
  isActive: true
};

function TerminalModal({ opened, terminal, onClose }: Readonly<{ opened: boolean; terminal: PosTerminal | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const [f, setF] = useState<PosTerminalInput>(EMPTY);
  const warehouses = useQuery({ queryKey: ["lookup", "warehouses"], queryFn: () => settingsApi.lookup("warehouses"), enabled: opened });
  const lists = useQuery({ queryKey: ["lookup", "sales-price-lists"], queryFn: () => settingsApi.lookup("sales-price-lists"), enabled: opened });
  const customers = useQuery({ queryKey: ["lookup", "customers"], queryFn: () => settingsApi.lookup("customers"), enabled: opened });

  useEffect(() => {
    if (!opened) return;
    setF(
      terminal
        ? {
            code: terminal.code,
            name: terminal.name,
            warehouseId: terminal.warehouseId,
            priceListId: terminal.priceListId,
            defaultCustomerId: terminal.defaultCustomerId,
            ticketPrefix: terminal.ticketPrefix,
            ticketPadding: terminal.ticketPadding,
            notes: terminal.notes,
            isActive: terminal.isActive
          }
        : EMPTY
    );
  }, [opened, terminal]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, ticketPrefix: f.ticketPrefix || undefined, notes: f.notes || null };
      return terminal ? posApi.updateTerminal(terminal.id, body) : posApi.createTerminal(body);
    },
    onSuccess: () => {
      notifySuccess(terminal ? "Caja actualizada" : "Caja creada");
      qc.invalidateQueries({ queryKey: ["pos", "terminals"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const options = (items: { id: string; code: string; name: string }[] | undefined) => (items ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }));
  const prefixLocked = Boolean(terminal && terminal.nextTicket > 1);
  const preview = `${f.ticketPrefix || (f.code ? `${f.code}-` : "")}${String(terminal?.nextTicket ?? 1).padStart(f.ticketPadding, "0")}`;
  const valid = CODE_RE.test(f.code) && f.name.trim().length >= 2 && Boolean(f.warehouseId) && PREFIX_RE.test(f.ticketPrefix ?? "");

  return (
    <FormModal opened={opened} onClose={onClose} title={terminal ? `Editar caja ${terminal.code}` : "Nueva caja"} onSubmit={() => save.mutate()} loading={save.isPending} valid={valid} size="lg">
      <Group grow align="flex-start">
        <TextInput label="Código" required value={f.code} onChange={(e) => setF({ ...f, code: e.currentTarget.value.toUpperCase() })} error={f.code && !CODE_RE.test(f.code) ? "Letras, números, guion o guion bajo" : null} />
        <TextInput label="Nombre" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Group>
      <Select
        label="Almacén"
        description="De aquí sale la mercancía vendida en esta caja"
        required
        searchable
        data={options(warehouses.data)}
        value={f.warehouseId || null}
        onChange={(v) => setF({ ...f, warehouseId: v ?? "" })}
        disabled={Boolean(terminal?.openSessionId)}
      />
      <Select
        label="Lista de precios"
        description="Sin lista: la del cliente o el precio de referencia del producto"
        clearable
        searchable
        data={options(lists.data)}
        value={f.priceListId}
        onChange={(v) => setF({ ...f, priceListId: v })}
      />
      <Select
        label="Cliente por defecto"
        description="Sin cliente: «Consumidor final»"
        clearable
        searchable
        data={options(customers.data)}
        value={f.defaultCustomerId}
        onChange={(v) => setF({ ...f, defaultCustomerId: v })}
      />
      <Group grow align="flex-start">
        <TextInput
          label="Prefijo de comprobantes"
          placeholder={f.code ? `${f.code}-` : "CAJA1-"}
          disabled={prefixLocked}
          description={prefixLocked ? "Ya emitió comprobantes: no cambia" : "Único en la empresa"}
          value={f.ticketPrefix ?? ""}
          onChange={(e) => setF({ ...f, ticketPrefix: e.currentTarget.value.toUpperCase() })}
          error={PREFIX_RE.test(f.ticketPrefix ?? "") ? null : "Letras, números o guion (máx. 10)"}
        />
        <NumberInput label="Dígitos" min={4} max={12} value={f.ticketPadding} onChange={(v) => setF({ ...f, ticketPadding: Number(v) || 8 })} description={`Siguiente: ${preview}`} />
      </Group>
      <Textarea label="Observaciones" autosize minRows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.currentTarget.value })} />
      <Switch label="Activa" checked={f.isActive} disabled={Boolean(terminal?.openSessionId)} onChange={(e) => setF({ ...f, isActive: e.currentTarget.checked })} />
    </FormModal>
  );
}

/** El supervisor fija su clave corta (la pide la caja para descuentos sobre el límite y anulaciones) */
function SupervisorPinModal({ opened, onClose }: Readonly<{ opened: boolean; onClose: () => void }>) {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (opened) {
      setPassword("");
      setPin("");
    }
  }, [opened]);
  const save = useMutation({
    mutationFn: () => posApi.setSupervisorPin(password, pin),
    onSuccess: () => {
      notifySuccess("Clave de supervisor guardada");
      onClose();
    },
    onError: (err) => notifyError(err)
  });
  return (
    <FormModal opened={opened} onClose={onClose} title="Mi clave de supervisor" onSubmit={() => save.mutate()} loading={save.isPending} valid={password.length > 0 && /^\d{4,8}$/.test(pin)}>
      <Text size="sm" c="dimmed">
        De 4 a 8 dígitos. La caja la pide para autorizar descuentos sobre el límite y anulaciones. Cinco intentos fallidos la bloquean 15 minutos.
      </Text>
      <PasswordInput
        label="Clave"
        required
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={pin}
        onChange={(e) => setPin(e.currentTarget.value.replace(/D/g, ""))}
        error={pin && !/^d{4,8}$/.test(pin) ? "De 4 a 8 dígitos" : null}
      />
      <PasswordInput label="Su contraseña (para confirmar)" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
    </FormModal>
  );
}

export default function PosTerminalsPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE);
  const canApprove = useCan("POS_SALES")("approve");
  const list = useQuery({ queryKey: ["pos", "terminals"], queryFn: posApi.listTerminals });
  const [modal, setModal] = useState<{ open: boolean; terminal: PosTerminal | null }>({ open: false, terminal: null });
  const [pinOpen, setPinOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => posApi.deleteTerminal(id),
    onSuccess: () => {
      notifySuccess("Caja eliminada");
      qc.invalidateQueries({ queryKey: ["pos", "terminals"] });
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<PosTerminal, unknown>[]>(
    () => [
      {
        header: "Caja",
        cell: ({ row: { original: t } }) => (
          <div>
            <Text size="sm" fw={700}>
              {t.code} {!t.isActive && <Badge size="xs" color="gray">Inactiva</Badge>}
            </Text>
            <Text size="xs" c="dimmed">
              {t.name}
            </Text>
          </div>
        )
      },
      { header: "Almacén", cell: ({ row: { original: t } }) => <Text size="sm">{t.warehouseCode}</Text> },
      { header: "Lista de precios", cell: ({ row: { original: t } }) => <Text size="sm">{t.priceListName ?? "—"}</Text> },
      { header: "Cliente por defecto", cell: ({ row: { original: t } }) => <Text size="sm">{t.defaultCustomerName ?? "Consumidor final"}</Text> },
      {
        header: "Próximo comprobante",
        cell: ({ row: { original: t } }) => (
          <Text size="sm" ff="monospace">
            {t.ticketPrefix}
            {String(t.nextTicket).padStart(t.ticketPadding, "0")}
          </Text>
        )
      },
      {
        header: "Turno",
        cell: ({ row: { original: t } }) =>
          t.openSessionId ? (
            <Tooltip label={t.openSessionCashier}>
              <Badge color="teal" variant="light">
                Abierto · {t.openSessionNumber}
              </Badge>
            </Tooltip>
          ) : (
            <Badge color="gray" variant="light">
              Cerrada
            </Badge>
          )
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row: { original: t } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {can("edit") && (
              <ActionIcon variant="subtle" aria-label="Editar" onClick={() => setModal({ open: true, terminal: t })}>
                <IconPencil size={18} />
              </ActionIcon>
            )}
            {can("delete") && (
              <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`la caja ${t.code}`, () => remove.mutate(t.id))}>
                <IconTrash size={18} />
              </ActionIcon>
            )}
          </Group>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Cajas"
        description="Cajas del punto de venta: almacén, lista de precios y correlativo de comprobantes"
        actions={POS_ACTIONS}
        right={
          <Group gap="xs">
            {canApprove && (
              <Button variant="default" leftSection={<IconKey size={16} />} onClick={() => setPinOpen(true)}>
                Mi clave de supervisor
              </Button>
            )}
            {can("add_new") && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, terminal: null })}>
                Nueva caja
              </Button>
            )}
          </Group>
        }
      />
      <Alert icon={<IconInfoCircle size={18} />} color="blue" variant="light" mb="md">
        El comprobante de la caja no es una factura fiscal.
      </Alert>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(t) => t.id} />
      <TerminalModal opened={modal.open} terminal={modal.terminal} onClose={() => setModal({ open: false, terminal: null })} />
      <SupervisorPinModal opened={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}
