/**
 * @project FabriHub - Front
 * @file src/layouts/components/ColorSchemeToggle.tsx
 * @description Botón del header para alternar modo claro / oscuro (se recuerda en el navegador)
 */

import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

export default function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const dark = useComputedColorScheme("light") === "dark";
  const label = dark ? "Modo claro" : "Modo oscuro";
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label={label} onClick={() => setColorScheme(dark ? "light" : "dark")}>
        {dark ? <IconSun size={20} /> : <IconMoon size={20} />}
      </ActionIcon>
    </Tooltip>
  );
}
