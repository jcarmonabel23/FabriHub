/**
 * @project FabriHub - Front
 * @file src/global/atoms/forms/ImageField.tsx
 * @description Campo de imagen (producto, logo, ícono): vista previa, subir, cambiar y quitar
 *
 * @overview
 * Quien lo usa decide cuándo subir: al elegir (registro existente) o después de crear (alta, con
 * `pending`). La API decide si el archivo es válido por su contenido; aquí solo se filtra por
 * tipo y tamaño para avisar antes.
 */

import { useEffect, useState } from "react";
import { ActionIcon, Button, FileButton, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconPhoto, IconTrash, IconUpload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

const reject = (message: string) => notifications.show({ title: "Imagen no válida", message, color: "red", withBorder: true });

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_MB = 5;

interface Props {
  label?: string;
  hint?: string;
  /** Medidas de la vista previa (clases de Tailwind) */
  previewClassName?: string;
  /** URL de la imagen actual (firmada por la API) */
  url: string | null;
  /** Archivo pendiente de subir (alta) */
  pending?: File | null;
  busy?: boolean;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}

export default function ImageField({
  label = "Imagen",
  hint = `PNG, JPG o WebP, hasta ${MAX_MB} MB. Se optimiza y se le quitan los metadatos.`,
  previewClassName = "w-28 h-28",
  url,
  pending,
  busy,
  disabled,
  onPick,
  onRemove
}: Readonly<Props>) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setPreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(pending);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pending]);

  const shown = preview ?? url;

  const pick = (file: File | null) => {
    if (!file) return;
    if (!IMAGE_ACCEPT.split(",").includes(file.type)) {
      reject("Solo se admiten imágenes PNG, JPG o WebP");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      reject(`La imagen supera ${MAX_MB} MB`);
      return;
    }
    onPick(file);
  };

  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <div className={`relative ${previewClassName} shrink-0 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden`}>
        {shown ? (
          <img src={shown} alt={label} className="w-full h-full object-contain" />
        ) : (
          <IconPhoto size={36} className="text-gray-300" />
        )}
        {busy && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader size="sm" />
          </div>
        )}
      </div>
      <Stack gap={6}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Group gap="xs">
          <FileButton onChange={pick} accept={IMAGE_ACCEPT} disabled={disabled || busy}>
            {(props) => (
              <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />} disabled={disabled || busy}>
                {shown ? "Cambiar" : "Subir imagen"}
              </Button>
            )}
          </FileButton>
          {shown && (
            <Tooltip label="Quitar">
              <ActionIcon variant="subtle" color="red" onClick={onRemove} disabled={disabled || busy} aria-label={`Quitar ${label.toLowerCase()}`}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
        <Text size="xs" c="dimmed" maw={320}>
          {hint}
        </Text>
      </Stack>
    </Group>
  );
}

/** Miniatura cuadrada para tablas y buscadores */
export function ImageThumb({ url, size = 36 }: Readonly<{ url: string | null | undefined; size?: number }>) {
  return (
    <div
      className="shrink-0 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" loading="lazy" className="w-full h-full object-contain" />
      ) : (
        <IconPhoto size={Math.round(size * 0.5)} className="text-gray-300" />
      )}
    </div>
  );
}
