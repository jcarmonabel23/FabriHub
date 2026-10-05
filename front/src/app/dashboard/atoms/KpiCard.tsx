/**
 * @project FabriHub - Front
 * @file src/app/dashboard/atoms/KpiCard.tsx
 * @description Tarjeta de indicador: etiqueta, valor, ayuda y estado (color) opcional
 */

import type { ComponentType } from "react";
import { Group, Paper, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  /** Explicación de cómo se calcula (tooltip) */
  help?: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  color?: string;
  onClick?: () => void;
}

export default function KpiCard({ label, value, hint, help, icon: Icon, color = "petrol", onClick }: Readonly<KpiCardProps>) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-shadow hover:shadow-md" : undefined}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div className="min-w-0">
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} lineClamp={1}>
              {label}
            </Text>
            {help && (
              <Tooltip label={help} multiline w={260} withArrow>
                <IconInfoCircle size={14} className="text-gray-400 shrink-0" />
              </Tooltip>
            )}
          </Group>
          <Text size="xl" fw={800} mt={2}>
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed" mt={2} lineClamp={1}>
              {hint}
            </Text>
          )}
        </div>
        <ThemeIcon size={40} radius="md" variant="light" color={color}>
          <Icon size={22} stroke={1.7} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}
