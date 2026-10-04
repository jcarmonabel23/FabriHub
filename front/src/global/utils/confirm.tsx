/**
 * @project FabriHub - Front
 * @file src/global/utils/confirm.tsx
 * @description Confirmación de baja con el nombre del registro (como en DaviHub: no se deshace)
 */

import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";

export function confirmDelete(what: string, onConfirm: () => void): void {
  modals.openConfirmModal({
    title: "Eliminar",
    children: (
      <Text size="sm">
        ¿Eliminar <b>{what}</b>? No se puede deshacer. Si está en uso, el sistema lo impedirá y podrá
        desactivarlo en su lugar.
      </Text>
    ),
    labels: { confirm: "Eliminar", cancel: "Cancelar" },
    confirmProps: { color: "red" },
    onConfirm
  });
}
