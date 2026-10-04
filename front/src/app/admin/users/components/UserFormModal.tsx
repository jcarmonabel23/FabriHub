/**
 * @project FabriHub - Front
 * @file src/app/admin/users/components/UserFormModal.tsx
 * @description Alta (correo + nombre; la contraseña temporal la genera y envía la API) y edición de nombre
 */

import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { IconMailForward } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@admin/services/admin.service";
import type { UserRow } from "@admin/types";
import { notifyError, notifySuccess } from "@utils/notify";

interface Props {
  opened: boolean;
  onClose: () => void;
  user?: UserRow | null;
}

export default function UserFormModal({ opened, onClose, user }: Readonly<Props>) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [names, setNames] = useState("");
  const editing = Boolean(user);

  useEffect(() => {
    if (opened) {
      setEmail(user?.email ?? "");
      setNames(user?.names ?? "");
    }
  }, [opened, user]);

  const mutation = useMutation({
    mutationFn: () =>
      editing ? adminApi.updateUser(user!.id, { names }) : adminApi.createUser({ email: email.trim().toLowerCase(), names }),
    onSuccess: () => {
      notifySuccess(editing ? "Usuario actualizado" : `Usuario creado. Se envió la contraseña temporal a ${email}`);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const valid = names.trim().length >= 3 && (editing || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? "Editar usuario" : "Nuevo usuario"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) mutation.mutate();
        }}
      >
        <Stack>
          <TextInput label="Correo electrónico" required disabled={editing} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <TextInput label="Nombre completo" required value={names} onChange={(e) => setNames(e.currentTarget.value)} />
          {!editing && (
            <Alert variant="light" color="petrol" icon={<IconMailForward size={18} />}>
              El sistema genera una contraseña temporal y la envía al correo. El usuario deberá cambiarla en su
              primer ingreso. Después asígnele módulos y roles.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!valid}>
              {editing ? "Guardar" : "Crear usuario"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
