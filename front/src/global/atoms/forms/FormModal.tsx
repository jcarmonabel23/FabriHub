/**
 * @project FabriHub - Front
 * @file src/global/atoms/forms/FormModal.tsx
 * @description Modal estándar de alta/edición: título, contenido, Cancelar / Guardar
 */

import type { ReactNode } from "react";
import { Button, Group, Modal, Stack, type ModalProps } from "@mantine/core";

interface FormModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  onSubmit: () => void;
  loading?: boolean;
  valid?: boolean;
  submitLabel?: string;
  size?: ModalProps["size"];
  children: ReactNode;
}

export default function FormModal({
  opened,
  onClose,
  title,
  onSubmit,
  loading,
  valid = true,
  submitLabel = "Guardar",
  size = "md",
  children
}: Readonly<FormModalProps>) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} size={size}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !loading) onSubmit();
        }}
      >
        <Stack>
          {children}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!valid}>
              {submitLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
