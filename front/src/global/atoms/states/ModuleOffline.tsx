/**
 * @project FabriHub - Front
 * @file src/global/atoms/states/ModuleOffline.tsx
 * @description Pantalla de módulo fuera de servicio (mantenimiento o fase aún no construida)
 */

import { Button, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconTool } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

export default function ModuleOffline({ moduleName, backTo = "/dashboard" }: Readonly<{ moduleName: string; backTo?: string }>) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center p-10 min-h-[60vh]">
      <Stack align="center" gap="md" className="max-w-md text-center">
        <ThemeIcon size={72} radius="xl" variant="light" color="petrol">
          <IconTool size={38} stroke={1.5} />
        </ThemeIcon>
        <Title order={3}>{moduleName} está fuera de servicio</Title>
        <Text c="dimmed" size="sm">
          El módulo está en mantenimiento o aún no se ha habilitado en esta versión. Intente más tarde o
          consulte al administrador.
        </Text>
        <Button variant="light" onClick={() => navigate(backTo)}>
          Volver al tablero
        </Button>
      </Stack>
    </div>
  );
}
