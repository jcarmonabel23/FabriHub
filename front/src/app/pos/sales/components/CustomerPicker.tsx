/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/CustomerPicker.tsx
 * @description Cliente de la venta: búsqueda por RIF, cédula o nombre, alta rápida y «Consumidor final»
 */

import { useEffect, useState } from "react";
import { Button, Divider, Group, Loader, Modal, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSearch, IconUser, IconUserPlus } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "@clients/apiClient";
import { notifyError } from "@utils/notify";
import { posApi } from "../../services/pos.service";
import type { PosCustomer } from "../../types";

interface Props {
  /** Cliente elegido; null = el de la caja o «Consumidor final» */
  value: PosCustomer | null;
  /** Cliente que el servidor aplicó en la última cotización (para mostrar el nombre real) */
  applied: PosCustomer | null;
  onChange: (c: PosCustomer | null) => void;
}

/** ¿Parece una cédula o RIF? (para ofrecer el alta con ese número) */
const looksLikeId = (s: string) => /^[VEJPGvejpg]?[\s-]?\d{5,9}[\s-]?\d?$/.test(s.trim());

export default function CustomerPicker({ value, applied, onChange }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [form, setForm] = useState<{ rif: string; name: string; phone: string } | null>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setForm(null);
    }
  }, [open]);

  const found = useQuery({
    queryKey: ["pos", "customers", debounced],
    queryFn: () => posApi.searchCustomers(debounced),
    enabled: open && debounced.length >= 2
  });

  const pick = (c: PosCustomer | null) => {
    onChange(c && !c.isFinalConsumer ? c : null);
    setOpen(false);
  };

  const create = useMutation({
    mutationFn: () => posApi.createCustomer({ rif: form!.rif, name: form!.name.trim(), phone: form!.phone.trim() || null }),
    onSuccess: pick,
    onError: async (err) => {
      // Ya existía: se elige el existente
      if (err instanceof ApiError && err.code === "CUSTOMER_EXISTS") {
        const [c] = await posApi.searchCustomers(form!.rif);
        if (c) return pick(c);
      }
      notifyError(err);
    }
  });

  const shown = applied ?? value;
  return (
    <>
      <UnstyledButton onClick={() => setOpen(true)} className="w-full rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50" aria-label="Cambiar cliente">
        <Group gap="xs" wrap="nowrap">
          <IconUser size={18} className="text-gray-500" />
          <div className="min-w-0 flex-1">
            <Text size="sm" fw={600} truncate>
              {shown?.name ?? "Consumidor final"}
            </Text>
            <Text size="xs" c="dimmed">
              {shown && !shown.isFinalConsumer ? shown.rif : "Sin identificar · toque para cambiar"}
            </Text>
          </div>
        </Group>
      </UnstyledButton>

      <Modal opened={open} onClose={() => setOpen(false)} title="Cliente de la venta" size="lg">
        <Stack>
          <TextInput
            data-autofocus
            placeholder="Cédula, RIF o nombre"
            leftSection={<IconSearch size={16} />}
            rightSection={found.isFetching ? <Loader size="xs" /> : null}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Stack gap={4}>
            {(found.data ?? []).map((c) => (
              <UnstyledButton key={c.id} onClick={() => pick(c)} className="rounded-md px-3 py-2 hover:bg-gray-100">
                <Text size="sm" fw={600}>
                  {c.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {c.rif}
                  {c.phone ? ` · ${c.phone}` : ""}
                </Text>
              </UnstyledButton>
            ))}
            {debounced.length >= 2 && found.data && !found.data.length && (
              <Text size="sm" c="dimmed">
                No hay clientes para «{debounced}».
              </Text>
            )}
          </Stack>

          {form ? (
            <Stack gap="xs" className="rounded-lg bg-gray-50 p-3">
              <Group grow align="flex-start">
                <TextInput label="Cédula o RIF" required placeholder="V-12345678" value={form.rif} onChange={(e) => setForm({ ...form, rif: e.currentTarget.value })} />
                <TextInput label="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} />
              </Group>
              <TextInput label="Nombre o razón social" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button loading={create.isPending} disabled={form.rif.trim().length < 5 || form.name.trim().length < 3} onClick={() => create.mutate()}>
                  Registrar y usar
                </Button>
              </Group>
            </Stack>
          ) : (
            <Button variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => setForm({ rif: looksLikeId(search) ? search.trim() : "", name: looksLikeId(search) ? "" : search.trim(), phone: "" })}>
              Cliente nuevo
            </Button>
          )}
          <Divider />
          <Button variant="subtle" color="gray" onClick={() => pick(null)}>
            Usar «Consumidor final» (o el cliente de la caja)
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
