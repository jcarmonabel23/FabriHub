/**
 * @project FabriHub - Front
 * @file src/app/settings/commercial/components/CatalogTab.tsx
 * @description Tabla + formulario genéricos de un catálogo simple, dirigidos por CatalogUi
 *
 * Lo usan Catálogos comerciales (SET_COMMERCIAL) y Catálogos de inventario (INV_CATALOGS): los
 * permisos salen de `ui.module`. Los registros del sistema muestran bloqueados sus campos fijos
 * y no ofrecen Eliminar (la API también lo impide).
 */

import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, NumberInput, Select, Switch, Text, TextInput, Textarea, Tooltip } from "@mantine/core";
import { IconCurrencyDollar, IconPencil, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "../../services/settings.service";
import type { CatalogItem } from "../../types";
import type { CatalogUi, FieldUi } from "../catalogsUi";

type FormState = Record<string, unknown>;

type Options = Record<string, { value: string; label: string }[]>;

function FieldInput({
  field,
  value,
  onChange,
  options,
  locked
}: Readonly<{ field: FieldUi; value: unknown; onChange: (v: unknown) => void; options: Options; locked: boolean }>) {
  const description = locked ? "Fijo en registros del sistema" : undefined;
  if (field.type === "switch") {
    return <Switch mt="lg" label={field.label} checked={Boolean(value)} disabled={locked} onChange={(e) => onChange(e.currentTarget.checked)} />;
  }
  if (field.type === "ref") {
    return (
      <Select
        label={field.label}
        description={description}
        data={options[field.lookup ?? ""] ?? []}
        value={(value as string) ?? null}
        disabled={locked}
        searchable
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <NumberInput
        label={field.label}
        min={field.min}
        max={field.max}
        allowDecimal={false}
        value={value as number}
        onChange={(v) => onChange(typeof v === "number" ? v : 0)}
      />
    );
  }
  if (field.type === "select") {
    return <Select label={field.label} description={description} disabled={locked} data={field.options ?? []} value={String(value)} onChange={(v) => onChange(v)} />;
  }
  return <TextInput label={field.label} value={String(value ?? "")} onChange={(e) => onChange(e.currentTarget.value)} />;
}

export default function CatalogTab({ ui, onRates }: Readonly<{ ui: CatalogUi; onRates?: (c: CatalogItem) => void }>) {
  const qc = useQueryClient();
  const can = useCan(ui.module);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({});

  const list = useQuery({ queryKey: ["settings", "catalog", ui.key], queryFn: () => settingsApi.listCatalog(ui.key) });

  // Opciones de los campos de referencia (p. ej. tipo de movimiento de un concepto)
  const lookups = [...new Set(ui.fields.filter((f) => f.type === "ref" && f.lookup).map((f) => f.lookup!))];
  const refData = useQuery({
    queryKey: ["lookups", ...lookups],
    enabled: lookups.length > 0,
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          lookups.map(async (l) => [l, (await settingsApi.lookup(l)).map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` }))] as const)
        )
      ) as Options
  });
  const options: Options = refData.data ?? {};
  const renderValue = (f: FieldUi, v: unknown): string => {
    if (f.render) return f.render(v);
    if (f.type === "ref") return options[f.lookup ?? ""]?.find((o) => o.value === v)?.label ?? "—";
    if (f.type === "switch") return v ? "Sí" : "No";
    return String(v ?? "");
  };

  useEffect(() => {
    if (!open) return;
    const base: FormState = {
      code: editing?.code ?? "",
      name: editing?.name ?? "",
      description: editing?.description ?? ""
    };
    for (const f of ui.fields) base[f.key] = editing ? editing[f.key] : f.default;
    setForm(base);
  }, [open, editing, ui]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["settings", "catalog", ui.key] });

  const save = useMutation({
    mutationFn: () => {
      const extra = Object.fromEntries(
        ui.fields.filter((f) => !(editing?.isSystem && f.systemLocked)).map((f) => [f.key, form[f.key]])
      );
      const common = { name: form.name, description: (form.description as string) || null };
      return editing
        ? settingsApi.updateCatalogItem(ui.key, editing.id, { ...common, ...extra })
        : settingsApi.createCatalogItem(ui.key, { code: form.code, ...common, ...extra });
    },
    onSuccess: () => {
      notifySuccess(editing ? "Registro actualizado" : "Registro creado");
      refresh();
      setOpen(false);
    },
    onError: (err) => notifyError(err)
  });

  const toggle = useMutation({
    mutationFn: (c: CatalogItem) => settingsApi.updateCatalogItem(ui.key, c.id, { isActive: !c.isActive }),
    onSuccess: refresh,
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (c: CatalogItem) => settingsApi.deleteCatalogItem(ui.key, c.id),
    onSuccess: () => {
      notifySuccess("Registro eliminado");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [list.data, search]);

  const columns = useMemo<ColumnDef<CatalogItem, unknown>[]>(
    () => [
      {
        header: "Código",
        size: 130,
        cell: ({ row: { original: c } }) => (
          <Text fw={700} size="sm">
            {c.code}{" "}
            {Boolean(c.isSystem) && (
              <Badge size="xs" color="gray">
                Sistema
              </Badge>
            )}
          </Text>
        )
      },
      {
        header: "Nombre",
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm">{c.name}</Text>
            {c.description && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {c.description}
              </Text>
            )}
          </div>
        )
      },
      ...ui.fields.map<ColumnDef<CatalogItem, unknown>>((f) => ({
        id: f.key,
        header: f.label,
        cell: ({ row: { original: c } }) => <Text size="sm">{renderValue(f, c[f.key])}</Text>
      })),
      {
        header: "Activo",
        size: 80,
        cell: ({ row: { original: c } }) => (
          <Switch checked={c.isActive} disabled={!can("edit")} onChange={() => toggle.mutate(c)} aria-label="Activo" />
        )
      },
      {
        id: "actions",
        header: "",
        size: 120,
        cell: ({ row: { original: c } }) => (
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {onRates && (
              <Tooltip label="Tasas de cambio">
                <ActionIcon variant="subtle" aria-label="Tasas" onClick={() => onRates(c)}>
                  <IconCurrencyDollar size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {can("edit") && (
              <Tooltip label="Editar">
                <ActionIcon
                  variant="subtle"
                  aria-label="Editar"
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                >
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {can("delete") && !c.isSystem && (
              <Tooltip label="Eliminar">
                <ActionIcon variant="subtle" color="red" aria-label="Eliminar" onClick={() => confirmDelete(`${c.code} · ${c.name}`, () => remove.mutate(c))}>
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui, can, onRates]
  );

  const codeOk = editing || /^[A-Za-z0-9_-]+$/.test(String(form.code ?? "")) && String(form.code).length <= ui.codeMaxLength;
  const valid = Boolean(codeOk) && String(form.name ?? "").trim().length >= 2;

  return (
    <>
      <Group justify="space-between" mb="md">
        <TextInput placeholder="Buscar por código o nombre" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
        {can("add_new") && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Agregar {ui.singular}
          </Button>
        )}
      </Group>
      <DataTable data={rows} columns={columns} loading={list.isLoading} rowKey={(c) => c.id} />

      <FormModal
        opened={open}
        onClose={() => setOpen(false)}
        title={editing ? `Editar ${ui.singular}` : `${ui.feminine ? "Nueva" : "Nuevo"} ${ui.singular}`}
        onSubmit={() => save.mutate()}
        loading={save.isPending}
        valid={valid}
      >
        <Group grow align="flex-start">
          <TextInput
            label="Código"
            description={editing ? "No se modifica: lo usan los documentos" : ui.codeHint}
            required
            disabled={Boolean(editing)}
            maxLength={ui.codeMaxLength}
            value={String(form.code ?? "")}
            onChange={(e) => setForm({ ...form, code: e.currentTarget.value.toUpperCase() })}
          />
          <TextInput label="Nombre" required value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        </Group>
        {ui.fields.length > 0 && (
          <Group grow align="flex-start">
            {ui.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={form[f.key]}
                options={options}
                locked={Boolean(editing?.isSystem && f.systemLocked)}
                onChange={(v) => setForm({ ...form, [f.key]: v })}
              />
            ))}
          </Group>
        )}
        <Textarea label="Descripción" autosize minRows={2} value={String(form.description ?? "")} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
        {editing && !editing.isActive && (
          <Badge color="gray" variant="light">
            Inactivo: no aparece en los formularios de otros módulos
          </Badge>
        )}
      </FormModal>
    </>
  );
}
