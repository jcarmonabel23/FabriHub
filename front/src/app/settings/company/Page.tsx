/**
 * @project FabriHub - Front
 * @file src/app/settings/company/Page.tsx
 * @description Parámetros → Empresa (SET_COMPANY): datos fiscales y moneda base
 */

import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput, Textarea, Title } from "@mantine/core";
import { IconAlertTriangle, IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { settingsApi } from "../services/settings.service";
import { SETTINGS_ACTIONS } from "../settingsActions";
import type { Company } from "../types";

const RIF_RE = /^[VEJPG]-\d{8}-\d$/;
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: dayjs().month(i).format("MMMM") }));

type Form = Omit<Company, "baseCurrencyCode" | "updatedAt">;

export default function CompanyPage() {
  const qc = useQueryClient();
  const can = useCan("SET_COMPANY");
  const readOnly = !can("edit");
  const company = useQuery({ queryKey: ["settings", "company"], queryFn: settingsApi.getCompany });
  const currencies = useQuery({ queryKey: ["lookup", "currencies"], queryFn: () => settingsApi.lookup("currencies") });
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (company.data) {
      const { baseCurrencyCode: _c, updatedAt: _u, ...rest } = company.data;
      setForm(rest);
    }
  }, [company.data]);

  const save = useMutation({
    mutationFn: () => settingsApi.updateCompany(form!),
    onSuccess: (data) => {
      notifySuccess("Datos de la empresa guardados");
      qc.setQueryData(["settings", "company"], data);
    },
    onError: (err) => notifyError(err)
  });

  if (!form || !company.data) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const rifOk = RIF_RE.test(form.rif.toUpperCase());
  const isPlaceholder = company.data.rif === "J-00000000-0";

  return (
    <div className="p-6">
      <ModuleHeader title="Empresa" description="Datos fiscales de la compañía y moneda base" actions={SETTINGS_ACTIONS} />

      {isPlaceholder && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} mb="md">
          La empresa tiene datos provisionales. Complete la razón social y el RIF antes de emitir documentos.
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (rifOk && !readOnly) save.mutate();
        }}
      >
        <Stack gap="lg" maw={980}>
          <Paper withBorder radius="lg" p="lg">
            <Title order={5} mb="md">
              Identificación
            </Title>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput label="Razón social" required readOnly={readOnly} value={form.legalName} onChange={(e) => set("legalName", e.currentTarget.value)} />
              <TextInput label="Nombre comercial" readOnly={readOnly} value={form.tradeName ?? ""} onChange={(e) => set("tradeName", e.currentTarget.value)} />
              <TextInput
                label="RIF"
                required
                readOnly={readOnly}
                placeholder="J-12345678-9"
                value={form.rif}
                onChange={(e) => set("rif", e.currentTarget.value.toUpperCase())}
                error={form.rif && !rifOk ? "Formato: letra (V, E, J, P o G), 8 dígitos y dígito verificador" : null}
              />
              <TextInput label="Correo" type="email" readOnly={readOnly} value={form.email ?? ""} onChange={(e) => set("email", e.currentTarget.value)} />
              <TagsInput
                label="Teléfonos"
                description="Hasta 3; Enter para agregar"
                maxTags={3}
                readOnly={readOnly}
                value={form.phones}
                onChange={(v) => set("phones", v)}
              />
              <TextInput label="Sitio web" readOnly={readOnly} value={form.website ?? ""} onChange={(e) => set("website", e.currentTarget.value)} />
            </SimpleGrid>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Title order={5} mb="md">
              Dirección fiscal
            </Title>
            <Stack>
              <Textarea label="Dirección" autosize minRows={2} readOnly={readOnly} value={form.address ?? ""} onChange={(e) => set("address", e.currentTarget.value)} />
              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <TextInput label="Ciudad" readOnly={readOnly} value={form.city ?? ""} onChange={(e) => set("city", e.currentTarget.value)} />
                <TextInput label="Estado" readOnly={readOnly} value={form.state ?? ""} onChange={(e) => set("state", e.currentTarget.value)} />
                <TextInput label="País" required readOnly={readOnly} value={form.country} onChange={(e) => set("country", e.currentTarget.value)} />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Title order={5} mb="md">
              Fiscal y contable
            </Title>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Select
                label="Moneda base"
                description="Las tasas de cambio se expresan contra esta moneda"
                data={(currencies.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
                value={form.baseCurrencyId}
                onChange={(v) => v && set("baseCurrencyId", v)}
                readOnly={readOnly}
              />
              <Select
                label="Inicio del ejercicio fiscal"
                data={MONTHS}
                value={String(form.fiscalYearStartMonth)}
                onChange={(v) => v && set("fiscalYearStartMonth", Number(v))}
                readOnly={readOnly}
              />
              <Switch
                label="Contribuyente especial"
                description="Designado por el SENIAT"
                checked={form.isSpecialTaxpayer}
                disabled={readOnly}
                onChange={(e) => set("isSpecialTaxpayer", e.currentTarget.checked)}
              />
              <Switch
                label="Agente de retención"
                description="Retiene IVA/ISLR a sus proveedores al pagar"
                checked={form.isWithholdingAgent}
                disabled={readOnly}
                onChange={(e) => set("isWithholdingAgent", e.currentTarget.checked)}
              />
            </SimpleGrid>
          </Paper>

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Última modificación: {fmtDateTime(company.data.updatedAt)}
            </Text>
            {!readOnly && (
              <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} disabled={!rifOk || form.legalName.trim().length < 3}>
                Guardar cambios
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </div>
  );
}
