/**
 * @project FabriHub - Front
 * @file src/layouts/components/CompanySwitcher.tsx
 * @description Empresa activa en la cabecera; si el usuario pertenece a varias, permite cambiar
 *
 * @overview
 * El cambio vive en la sesión (API). Tras cambiar se recarga la app completa en /dashboard para
 * descartar cachés de React Query y estados de pantalla de la empresa anterior.
 */

import { Badge, Group, Loader, Menu, Text, UnstyledButton } from "@mantine/core";
import { IconBuilding, IconCheck, IconChevronDown, IconStar } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { myCompaniesRequest, switchCompanyRequest } from "@auth/services/auth.service";
import { notifyError } from "@utils/notify";

export default function CompanySwitcher() {
  const company = coreAuth((s) => s.company);
  const [opened, setOpened] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const companies = useQuery({ queryKey: ["auth", "companies"], queryFn: myCompaniesRequest, enabled: opened, staleTime: 60_000 });
  if (!company) return null;

  const switchTo = async (companyId: string, makeDefault = false) => {
    setSwitching(companyId);
    try {
      const payload = await switchCompanyRequest(companyId, makeDefault);
      coreAuth.getState().setSession(payload);
      window.location.assign("/dashboard");
    } catch (err) {
      notifyError(err);
      setSwitching(null);
    }
  };

  return (
    <Menu position="bottom-start" width={280} shadow="md" opened={opened} onChange={setOpened}>
      <Menu.Target>
        <UnstyledButton className="rounded-lg px-2 py-1 hover:bg-gray-50 min-w-0" aria-label="Empresa activa">
          <Group gap={6} wrap="nowrap">
            <IconBuilding size={18} className="text-gray-500 shrink-0" />
            <Text size="sm" fw={600} lineClamp={1} maw={220}>
              {company.name}
            </Text>
            <IconChevronDown size={14} className="text-gray-400 shrink-0" />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Empresas</Menu.Label>
        {companies.isLoading && (
          <Group justify="center" p="sm">
            <Loader size="sm" />
          </Group>
        )}
        {(companies.data ?? []).map((c) => (
          <Menu.Item
            key={c.id}
            disabled={Boolean(switching)}
            closeMenuOnClick={false}
            onClick={() => !c.isCurrent && switchTo(c.id)}
            leftSection={c.isCurrent ? <IconCheck size={16} className="text-teal-600" /> : <span className="w-4" />}
            rightSection={
              switching === c.id ? (
                <Loader size={14} />
              ) : c.isDefault ? (
                <Badge size="xs" variant="light" color="gray">
                  Predeterminada
                </Badge>
              ) : null
            }
          >
            <Text size="sm" fw={c.isCurrent ? 600 : 400} lineClamp={1}>
              {c.name}
            </Text>
            <Text size="xs" c="dimmed">
              {c.code} · {c.rif}
            </Text>
          </Menu.Item>
        ))}
        {companies.data?.some((c) => c.isCurrent && !c.isDefault) && (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<IconStar size={16} />} onClick={() => switchTo(company.id, true)}>
              Abrir siempre en esta empresa
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
