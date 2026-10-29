/**
 * @project FabriHub - Front
 * @file src/app/admin/companies/Page.tsx
 * @description Seguridad → Empresas (ADM_COMPANIES, solo administradores de plataforma)
 *
 * @overview
 * Alta de empresas (nacen con la configuración base de la empresa activa: parámetros, numeración y
 * catálogos comerciales), edición, suspensión y miembros. Cada empresa tiene sus propios
 * administradores; quien la crea queda como miembro administrador para poder entrar a configurarla.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPencil, IconPlus, IconTrash, IconUsers } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { ADMIN_ACTIONS } from "@admin/adminActions";
import { adminApi } from "@admin/services/admin.service";
import type { CompanyInput, CompanyRow } from "@admin/types";
import { coreAuth } from "@auth/store/coreAuth";
import { useCan } from "@modules/access-control/useCan";
import { settingsApi } from "@/app/settings/services/settings.service";
import { fmtDateTime } from "@utils/format";
import { notifyError, notifySuccess } from "@utils/notify";

const MODULE_CODE = "ADM_COMPANIES";
const RIF_RE = /^[VEJPG]-\d{8}-\d$/;
const CODE_RE = /^[A-Z0-9_-]{2,20}$/;

const EMPTY: CompanyInput & { code: string } = {
  code: "",
  legalName: "",
  tradeName: "",
  rif: "",
  city: "",
  country: "Venezuela",
  email: "",
  baseCurrencyId: ""
};

function CompanyModal({ opened, company, onClose }: Readonly<{ opened: boolean; company: CompanyRow | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const currencies = useQuery({ queryKey: ["lookup", "currencies"], queryFn: () => settingsApi.lookup("currencies"), enabled: opened });
  const [form, setForm] = useState(EMPTY);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminNames, setAdminNames] = useState("");
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!opened) return;
    setForm(
      company
        ? {
            code: company.code,
            legalName: company.legalName,
            tradeName: company.tradeName ?? "",
            rif: company.rif,
            city: company.city ?? "",
            country: company.country,
            email: company.email ?? "",
            baseCurrencyId: company.baseCurrencyId
          }
        : EMPTY
    );
    setAdminEmail("");
    setAdminNames("");
  }, [opened, company]);

  const save = useMutation({
    mutationFn: () => {
      const { code, ...fields } = form;
      if (company) return adminApi.updateCompany(company.id, fields);
      const admin = adminEmail.trim() ? { email: adminEmail.trim().toLowerCase(), names: adminNames.trim() || undefined } : undefined;
      return adminApi.createCompany({ ...fields, code, admin });
    },
    onSuccess: () => {
      notifySuccess(company ? "Empresa actualizada" : "Empresa creada. Cámbiese a ella desde la cabecera para configurarla.");
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["auth", "companies"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const valid =
    form.legalName.trim().length >= 3 &&
    RIF_RE.test(form.rif) &&
    Boolean(form.baseCurrencyId) &&
    (company || CODE_RE.test(form.code));

  return (
    <Modal opened={opened} onClose={onClose} title={company ? `Editar empresa: ${company.code}` : "Nueva empresa"} size="lg">
      <Stack>
        <Group grow align="flex-start">
          <TextInput
            label="Código"
            description="2 a 20 letras, números, - o _"
            required
            disabled={Boolean(company)}
            value={form.code}
            onChange={(e) => set({ code: e.currentTarget.value.toUpperCase() })}
          />
          <TextInput
            label="RIF"
            description="J-12345678-9"
            required
            value={form.rif}
            error={form.rif && !RIF_RE.test(form.rif) ? "Formato inválido" : undefined}
            onChange={(e) => set({ rif: e.currentTarget.value.toUpperCase() })}
          />
        </Group>
        <TextInput label="Razón social" required value={form.legalName} onChange={(e) => set({ legalName: e.currentTarget.value })} />
        <TextInput label="Nombre comercial" value={form.tradeName ?? ""} onChange={(e) => set({ tradeName: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Ciudad" value={form.city ?? ""} onChange={(e) => set({ city: e.currentTarget.value })} />
          <TextInput label="País" value={form.country ?? ""} onChange={(e) => set({ country: e.currentTarget.value })} />
        </Group>
        <Group grow>
          <TextInput label="Correo" type="email" value={form.email ?? ""} onChange={(e) => set({ email: e.currentTarget.value })} />
          <Select
            label="Moneda base"
            required
            searchable
            data={(currencies.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            value={form.baseCurrencyId || null}
            onChange={(v) => set({ baseCurrencyId: v ?? "" })}
          />
        </Group>
        {!company && (
          <>
            <Divider label="Administrador de la empresa (opcional)" labelPosition="left" />
            <Text size="xs" c="dimmed">
              Si el correo no existe, se crea el usuario y se le envía una contraseña temporal. Recibe el rol Administrador en todos
              los módulos de la empresa. Usted también queda como administrador.
            </Text>
            <Group grow>
              <TextInput label="Correo" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.currentTarget.value)} />
              <TextInput
                label="Nombre"
                description="Solo si es un usuario nuevo"
                value={adminNames}
                onChange={(e) => setAdminNames(e.currentTarget.value)}
              />
            </Group>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function MembersDrawer({ company, canManage, onClose }: Readonly<{ company: CompanyRow | null; canManage: boolean; onClose: () => void }>) {
  const qc = useQueryClient();
  const me = coreAuth((s) => s.user);
  const current = coreAuth((s) => s.company);
  const key = ["admin", "companies", company?.id, "members"];
  const members = useQuery({ queryKey: key, queryFn: () => adminApi.companyMembers(company!.id), enabled: Boolean(company) });
  const [email, setEmail] = useState("");
  const [names, setNames] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);

  useEffect(() => {
    setEmail("");
    setNames("");
    setAsAdmin(false);
  }, [company]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["admin", "companies"] });
  };
  const add = useMutation({
    mutationFn: () =>
      adminApi.addCompanyMember(company!.id, { email: email.trim().toLowerCase(), names: names.trim() || undefined, asAdmin }),
    onSuccess: (r) => {
      notifySuccess(r.created ? `Usuario creado. Se envió la contraseña temporal a ${email}` : "Usuario agregado a la empresa");
      setEmail("");
      setNames("");
      refresh();
    },
    onError: (err) => notifyError(err)
  });
  const remove = useMutation({
    mutationFn: (userId: string) => adminApi.removeCompanyMember(company!.id, userId),
    onSuccess: () => {
      notifySuccess("Usuario retirado de la empresa");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  return (
    <Drawer opened={Boolean(company)} onClose={onClose} position="right" size="lg" title={`Miembros · ${company?.legalName ?? ""}`}>
      <Stack gap="lg">
        {canManage && (
          <Stack gap="xs">
            <Group grow align="flex-end">
              <TextInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              <TextInput label="Nombre" description="Solo si es nuevo" value={names} onChange={(e) => setNames(e.currentTarget.value)} />
            </Group>
            <Group justify="space-between">
              <Checkbox
                label="Administrador de la empresa"
                checked={asAdmin}
                onChange={(e) => setAsAdmin(e.currentTarget.checked)}
              />
              <Button
                leftSection={<IconPlus size={16} />}
                disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
                loading={add.isPending}
                onClick={() => add.mutate()}
              >
                Agregar
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Sin «Administrador», el usuario entra sin módulos: asígneselos desde Usuarios estando en esa empresa.
            </Text>
          </Stack>
        )}
        {members.isLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Usuario</Table.Th>
                <Table.Th>Desde</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(members.data ?? []).map((m) => {
                const self = m.id === me?.id && company?.id === current?.id;
                return (
                  <Table.Tr key={m.id}>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {m.names}{" "}
                        {m.isPlatformAdmin && (
                          <Badge size="xs" color="petrol">
                            Plataforma
                          </Badge>
                        )}{" "}
                        {!m.isActive && (
                          <Badge size="xs" color="gray">
                            Inactivo
                          </Badge>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {m.email}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{fmtDateTime(m.memberSince)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Tooltip label={self ? "No puede retirarse de la empresa en la que trabaja" : "Retirar de la empresa"}>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            disabled={self}
                            aria-label="Retirar"
                            onClick={() =>
                              modals.openConfirmModal({
                                title: "Retirar de la empresa",
                                children: (
                                  <Text size="sm">
                                    ¿Retirar a {m.names} de {company?.legalName}? Pierde sus módulos y almacenes en ella; su cuenta sigue
                                    activa en sus otras empresas.
                                  </Text>
                                ),
                                labels: { confirm: "Retirar", cancel: "Cancelar" },
                                confirmProps: { color: "red" },
                                onConfirm: () => remove.mutate(m.id)
                              })
                            }
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Drawer>
  );
}

export default function CompaniesAdminPage() {
  const qc = useQueryClient();
  const can = useCan(MODULE_CODE);
  const current = coreAuth((s) => s.company);
  const companies = useQuery({ queryKey: ["admin", "companies"], queryFn: adminApi.listCompanies });
  const [modal, setModal] = useState<{ open: boolean; company: CompanyRow | null }>({ open: false, company: null });
  const [membersOf, setMembersOf] = useState<CompanyRow | null>(null);

  const toggle = useMutation({
    mutationFn: (c: CompanyRow) => adminApi.updateCompany(c.id, { isActive: !c.isActive }),
    onSuccess: (c) => {
      notifySuccess(c.isActive ? "Empresa reactivada" : "Empresa suspendida: sus usuarios ya no pueden entrar a ella");
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
      qc.invalidateQueries({ queryKey: ["auth", "companies"] });
    },
    onError: (err) => notifyError(err)
  });

  const confirmToggle = (c: CompanyRow) =>
    c.isActive
      ? modals.openConfirmModal({
          title: "Suspender empresa",
          children: (
            <Text size="sm">
              ¿Suspender «{c.legalName}»? Sus usuarios no podrán entrar a ella hasta que se reactive. Los datos se conservan.
            </Text>
          ),
          labels: { confirm: "Suspender", cancel: "Cancelar" },
          confirmProps: { color: "red" },
          onConfirm: () => toggle.mutate(c)
        })
      : toggle.mutate(c);

  const columns = useMemo<ColumnDef<CompanyRow, unknown>[]>(
    () => [
      {
        header: "Empresa",
        cell: ({ row: { original: c } }) => (
          <div>
            <Text size="sm" fw={600}>
              {c.tradeName || c.legalName}{" "}
              {c.id === current?.id && (
                <Badge size="xs" color="teal" variant="light">
                  Activa
                </Badge>
              )}
            </Text>
            <Text size="xs" c="dimmed">
              {c.code} · {c.rif}
              {c.tradeName ? ` · ${c.legalName}` : ""}
            </Text>
          </div>
        )
      },
      { header: "Moneda", accessorKey: "baseCurrencyCode", size: 90 },
      { header: "Ciudad", cell: ({ row: { original: c } }) => c.city ?? "—", size: 140 },
      { header: "Miembros", accessorKey: "membersCount", size: 90 },
      {
        header: "Activa",
        size: 80,
        cell: ({ row: { original: c } }) => (
          <Tooltip label="Cambie de empresa para suspender esta" disabled={c.id !== current?.id}>
            <Switch
              checked={c.isActive}
              disabled={!can("edit") || c.id === current?.id}
              onChange={() => confirmToggle(c)}
              aria-label="Activa"
            />
          </Tooltip>
        )
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row: { original: c } }) => (
          <Group gap={4} justify="flex-end">
            <Tooltip label="Miembros">
              <ActionIcon variant="subtle" onClick={() => setMembersOf(c)} aria-label="Miembros">
                <IconUsers size={18} />
              </ActionIcon>
            </Tooltip>
            {can("edit") && (
              <Tooltip label="Editar">
                <ActionIcon variant="subtle" onClick={() => setModal({ open: true, company: c })} aria-label="Editar">
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, current?.id]
  );

  return (
    <div className="p-6">
      <ModuleHeader
        title="Empresas"
        description="Empresas de la plataforma, su estado y sus miembros"
        actions={ADMIN_ACTIONS}
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, company: null })}>
              Nueva empresa
            </Button>
          )
        }
      />
      <DataTable data={companies.data ?? []} columns={columns} loading={companies.isLoading} rowKey={(c) => c.id} />
      <CompanyModal opened={modal.open} company={modal.company} onClose={() => setModal({ open: false, company: null })} />
      <MembersDrawer company={membersOf} canManage={can("configure")} onClose={() => setMembersOf(null)} />
    </div>
  );
}
