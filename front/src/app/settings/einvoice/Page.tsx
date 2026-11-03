/**
 * @project FabriHub - Front
 * @file src/app/settings/einvoice/Page.tsx
 * @description Configuración → Comprobantes electrónicos (Costa Rica, fase 18): datos del emisor,
 * ambiente de Hacienda, usuario del ATV, llave criptográfica (.p12), contingencia y bitácora
 *
 * Las credenciales se envían una sola vez y se guardan cifradas: la pantalla solo muestra si están
 * cargadas (y el titular y vencimiento del certificado), nunca su contenido.
 */

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconAlertTriangle, IconCertificate, IconDeviceFloppy, IconKey, IconSend } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCan } from "@modules/access-control/useCan";
import { useCountry } from "@modules/country/country";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";
import { SETTINGS_ACTIONS } from "../settingsActions";
import DocumentsPanel from "./components/DocumentsPanel";
import { EINV_STATUS, einvoiceApi, fileToBase64, type EinvoiceSettingsInput, type EinvStatus } from "./einvoice.service";

const PROVINCES = ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"].map((label, i) => ({ value: String(i + 1), label: `${i + 1} · ${label}` }));

const SERVICE_UNITS = [
  { value: "Sp", label: "Sp · Servicios profesionales" },
  { value: "Spe", label: "Spe · Servicios personales" },
  { value: "St", label: "St · Servicios técnicos" },
  { value: "Os", label: "Os · Otro tipo de servicio" },
  { value: "h", label: "h · Hora" }
];

export default function EinvoicePage() {
  const country = useCountry();
  if (!country.features.eInvoice) {
    return (
      <div className="p-6">
        <ModuleHeader title="Comprobantes electrónicos" description="Facturación electrónica de Hacienda" actions={SETTINGS_ACTIONS} />
        <Alert color="gray" variant="light">
          {country.name} no usa los comprobantes electrónicos del Ministerio de Hacienda de Costa Rica.
        </Alert>
      </div>
    );
  }
  return <EinvoiceSettingsView />;
}

function EinvoiceSettingsView() {
  const qc = useQueryClient();
  const can = useCan("SET_COMPANY");
  const readOnly = !can("edit");
  const canSeeDocs = useCan("POS_SALES")("view");
  const settings = useQuery({ queryKey: ["einvoice", "settings"], queryFn: einvoiceApi.settings });
  const [form, setForm] = useState<EinvoiceSettingsInput | null>(null);
  const [atvUser, setAtvUser] = useState("");
  const [atvPassword, setAtvPassword] = useState("");
  const [p12, setP12] = useState<File | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      isEnabled: s.isEnabled,
      environment: s.environment,
      activityCode: s.activityCode,
      providerId: s.providerId,
      province: s.province,
      canton: s.canton,
      district: s.district,
      neighborhood: s.neighborhood,
      otherSigns: s.otherSigns,
      serviceUnit: s.serviceUnit,
      contingency: s.contingency,
      ...(s.mockUrls ? { idpUrl: s.mockUrls.idpUrl, apiUrl: s.mockUrls.apiUrl } : {})
    });
  }, [settings.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["einvoice"] });
  const save = useMutation({
    mutationFn: (body: EinvoiceSettingsInput) => einvoiceApi.saveSettings(body),
    onSuccess: (data) => {
      notifySuccess("Configuración guardada");
      qc.setQueryData(["einvoice", "settings"], data);
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const saveCreds = useMutation({
    mutationFn: () => einvoiceApi.saveCredentials(atvUser.trim(), atvPassword),
    onSuccess: () => {
      notifySuccess("Usuario del ATV guardado (cifrado)");
      setAtvUser("");
      setAtvPassword("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const saveCert = useMutation({
    mutationFn: async () => einvoiceApi.saveCertificate(await fileToBase64(p12!), pin),
    onSuccess: (r) => {
      notifySuccess(`Llave cargada: vence el ${dayjs(r.expiresAt).format("DD/MM/YYYY")}`);
      setP12(null);
      setPin("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const removeCreds = useMutation({ mutationFn: einvoiceApi.deleteCredentials, onSuccess: refresh, onError: (err) => notifyError(err) });
  const removeCert = useMutation({ mutationFn: einvoiceApi.deleteCertificate, onSuccess: refresh, onError: (err) => notifyError(err) });
  const process = useMutation({
    mutationFn: einvoiceApi.processQueue,
    onSuccess: (r) => {
      notifySuccess(r.processed ? `Cola procesada: ${r.processed} comprobante(s)` : "No había nada pendiente");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const s = settings.data;
  if (!s || !form) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }

  const set = <K extends keyof EinvoiceSettingsInput>(k: K, v: EinvoiceSettingsInput[K]) => setForm({ ...form, [k]: v });
  const certExpiring = s.certificate.expiresAt && dayjs(s.certificate.expiresAt).diff(dayjs(), "day") < 30;
  const pending = (s.counts.pending ?? 0) + (s.counts.sent ?? 0);

  return (
    <div className="p-6">
      <ModuleHeader title="Comprobantes electrónicos" description="Tiquete, factura y nota de crédito electrónica v4.4 del Ministerio de Hacienda" actions={SETTINGS_ACTIONS} />

      <Stack gap="lg" maw={1100}>
        <Paper withBorder radius="lg" p="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Group gap="xs">
                <Title order={5}>Estado</Title>
                <Badge color={s.isEnabled ? "teal" : "gray"} variant="light">
                  {s.isEnabled ? "Activos" : "Apagados"}
                </Badge>
                <Badge color={s.environment === "prod" ? "red" : "blue"} variant="outline">
                  {s.environment === "prod" ? "Producción" : "Ambiente de pruebas"}
                </Badge>
                {s.contingency && (
                  <Badge color="orange" variant="filled">
                    Contingencia
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt={4}>
                Con los comprobantes activos, cada venta del POS emite un tiquete (consumidor final) o una factura (cliente identificado); anular la venta
                emite una nota de crédito. Se firman y envían a Hacienda en segundo plano.
              </Text>
              <Group gap="xs" mt="sm">
                {(Object.keys(EINV_STATUS) as EinvStatus[]).map((k) =>
                  s.counts[k] ? (
                    <Badge key={k} color={EINV_STATUS[k].color} variant="light">
                      {EINV_STATUS[k].label}: {s.counts[k]}
                    </Badge>
                  ) : null
                )}
              </Group>
            </div>
            {!readOnly && (
              <Button leftSection={<IconSend size={16} />} variant="light" loading={process.isPending} disabled={!pending} onClick={() => process.mutate()}>
                Procesar cola
              </Button>
            )}
          </Group>
          {!s.company.email && (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} mt="md">
              La empresa no tiene correo electrónico: es obligatorio en el comprobante. Cárguelo en Configuración → Empresa.
            </Alert>
          )}
        </Paper>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) save.mutate(form);
          }}
        >
          <Paper withBorder radius="lg" p="lg">
            <Title order={5} mb="md">
              Emisor
            </Title>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label="Actividad económica"
                description="Código de 6 dígitos inscrito en Hacienda"
                placeholder="620100"
                maxLength={6}
                readOnly={readOnly}
                value={form.activityCode ?? ""}
                onChange={(e) => set("activityCode", e.currentTarget.value.replace(/\D/g, "") || null)}
                error={form.activityCode && form.activityCode.length !== 6 ? "6 dígitos" : null}
              />
              <TextInput
                label="Proveedor de sistemas"
                description={`Cédula del proveedor; vacío = la de la empresa (${s.company.taxId ?? "—"})`}
                readOnly={readOnly}
                value={form.providerId ?? ""}
                onChange={(e) => set("providerId", e.currentTarget.value.replace(/\D/g, "") || null)}
              />
              <Select
                label="Unidad de los servicios"
                description="Para productos no inventariables"
                data={SERVICE_UNITS}
                readOnly={readOnly}
                value={form.serviceUnit}
                onChange={(v) => v && set("serviceUnit", v as EinvoiceSettingsInput["serviceUnit"])}
              />
              <Select
                label="Provincia"
                data={PROVINCES}
                readOnly={readOnly}
                value={form.province ? String(form.province) : null}
                onChange={(v) => set("province", v ? Number(v) : null)}
              />
              <NumberInput
                label="Cantón"
                description="Código de 2 dígitos"
                min={1}
                max={99}
                readOnly={readOnly}
                value={form.canton ? Number(form.canton) : ""}
                onChange={(v) => set("canton", v === "" ? null : String(v).padStart(2, "0"))}
              />
              <NumberInput
                label="Distrito"
                description="Código de 2 dígitos"
                min={1}
                max={99}
                readOnly={readOnly}
                value={form.district ? Number(form.district) : ""}
                onChange={(v) => set("district", v === "" ? null : String(v).padStart(2, "0"))}
              />
              <TextInput label="Barrio" readOnly={readOnly} value={form.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.currentTarget.value || null)} />
              <TextInput
                label="Otras señas"
                className="md:col-span-2"
                readOnly={readOnly}
                value={form.otherSigns ?? ""}
                onChange={(e) => set("otherSigns", e.currentTarget.value || null)}
              />
            </SimpleGrid>

            <Title order={5} mt="xl" mb="sm">
              Envío
            </Title>
            <Stack gap="sm">
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Ambiente de Hacienda
                </Text>
                <SegmentedControl
                  disabled={readOnly}
                  value={form.environment}
                  onChange={(v) => set("environment", v as "sandbox" | "prod")}
                  data={[
                    { value: "sandbox", label: "Pruebas (sandbox)" },
                    { value: "prod", label: "Producción" }
                  ]}
                />
                {form.environment === "prod" && s.environment !== "prod" && (
                  <Text size="xs" c="orange" mt={4}>
                    En producción los comprobantes tienen validez tributaria. Use el usuario del ATV y la llave de producción.
                  </Text>
                )}
              </div>
              {s.mockUrls && (
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  <TextInput
                    label="IdP simulado (solo pruebas)"
                    readOnly={readOnly}
                    value={form.idpUrl ?? ""}
                    onChange={(e) => set("idpUrl", e.currentTarget.value || null)}
                  />
                  <TextInput
                    label="Recepción simulada (solo pruebas)"
                    readOnly={readOnly}
                    value={form.apiUrl ?? ""}
                    onChange={(e) => set("apiUrl", e.currentTarget.value || null)}
                  />
                </SimpleGrid>
              )}
              <Switch
                label="Modo contingencia"
                description="Sin conexión con Hacienda: los comprobantes se emiten con situación «sin internet» y se envían al desactivarlo"
                checked={form.contingency}
                disabled={readOnly}
                onChange={(e) => set("contingency", e.currentTarget.checked)}
              />
              <Switch
                label="Emitir comprobantes electrónicos en el POS"
                description="Requiere la actividad económica, la ubicación, el correo de la empresa, el usuario del ATV y la llave criptográfica"
                checked={form.isEnabled}
                disabled={readOnly}
                onChange={(e) => set("isEnabled", e.currentTarget.checked)}
              />
            </Stack>
            {!readOnly && (
              <Group justify="flex-end" mt="md">
                <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending}>
                  Guardar configuración
                </Button>
              </Group>
            )}
          </Paper>
        </form>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Paper withBorder radius="lg" p="lg">
            <Group gap="xs" mb={4}>
              <IconKey size={18} />
              <Title order={5}>Usuario del ATV</Title>
              <Badge size="sm" color={s.credentials.configured ? "teal" : "orange"} variant="light">
                {s.credentials.configured ? `cargado ${s.credentials.userHint ?? ""}` : "falta"}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Usuario y clave de la API que genera el ATV de Hacienda (Comprobantes electrónicos → Generar usuario). Se guardan cifrados.
              {s.credentials.updatedAt && ` Último cambio: ${fmtDateTime(s.credentials.updatedAt)}.`}
            </Text>
            {!readOnly && (
              <Stack gap="xs">
                <TextInput label="Usuario" placeholder="cpj-3-101-123456@stag.comprobanteselectronicos.go.cr" value={atvUser} onChange={(e) => setAtvUser(e.currentTarget.value)} />
                <PasswordInput label="Clave" value={atvPassword} onChange={(e) => setAtvPassword(e.currentTarget.value)} />
                <Group justify="flex-end">
                  {s.credentials.configured && (
                    <Button variant="subtle" color="red" loading={removeCreds.isPending} onClick={() => removeCreds.mutate()}>
                      Quitar
                    </Button>
                  )}
                  <Button loading={saveCreds.isPending} disabled={atvUser.trim().length < 5 || atvPassword.length < 4} onClick={() => saveCreds.mutate()}>
                    Guardar
                  </Button>
                </Group>
              </Stack>
            )}
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Group gap="xs" mb={4}>
              <IconCertificate size={18} />
              <Title order={5}>Llave criptográfica</Title>
              <Badge size="sm" color={!s.certificate.configured ? "orange" : certExpiring ? "red" : "teal"} variant="light">
                {s.certificate.configured ? `vence ${dayjs(s.certificate.expiresAt).format("DD/MM/YYYY")}` : "falta"}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Archivo .p12 descargado del ATV y su PIN de 4 dígitos. Firma cada comprobante (XAdES-EPES). Se guarda cifrado.
            </Text>
            {s.certificate.subject && (
              <Text size="xs" ff="monospace" mb="sm" style={{ wordBreak: "break-all" }}>
                {s.certificate.subject}
              </Text>
            )}
            {!readOnly && (
              <Stack gap="xs">
                <FileInput label="Archivo .p12" accept=".p12,.pfx,application/x-pkcs12" clearable value={p12} onChange={setP12} />
                <PasswordInput label="PIN" value={pin} onChange={(e) => setPin(e.currentTarget.value)} />
                <Group justify="flex-end">
                  {s.certificate.configured && (
                    <Button variant="subtle" color="red" loading={removeCert.isPending} onClick={() => removeCert.mutate()}>
                      Quitar
                    </Button>
                  )}
                  <Button loading={saveCert.isPending} disabled={!p12 || !pin} onClick={() => saveCert.mutate()}>
                    Cargar llave
                  </Button>
                </Group>
              </Stack>
            )}
          </Paper>
        </SimpleGrid>

        {canSeeDocs && <DocumentsPanel />}
      </Stack>
    </div>
  );
}
