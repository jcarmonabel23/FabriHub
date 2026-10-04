/**
 * @project FabriHub - Front
 * @file src/app/auth/atoms/PasswordChecklist.tsx
 * @description Checklist en vivo de la política de contraseñas
 */

import { Stack, Text } from "@mantine/core";
import { IconCircleCheckFilled, IconCircleDashed } from "@tabler/icons-react";
import { PASSWORD_RULES } from "@utils/passwordRules";

export default function PasswordChecklist({ password, email }: Readonly<{ password: string; email?: string }>) {
  return (
    <Stack gap={4} className="rounded-lg bg-gray-50 px-3 py-2">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password, email);
        return (
          <Text key={rule.label} size="xs" c={ok ? "teal.7" : "gray.6"} className="flex items-center gap-2">
            {ok ? <IconCircleCheckFilled size={14} /> : <IconCircleDashed size={14} />}
            {rule.label}
          </Text>
        );
      })}
      <Text size="xs" c="gray.6" className="flex items-center gap-2">
        <IconCircleDashed size={14} />
        Distinta de sus últimas 5 contraseñas
      </Text>
    </Stack>
  );
}
