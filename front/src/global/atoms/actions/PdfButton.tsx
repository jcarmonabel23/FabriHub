/**
 * @project FabriHub - Front
 * @file src/global/atoms/actions/PdfButton.tsx
 * @description Descarga el PDF de un documento (con la sesión y la identidad de la empresa activa)
 */

import { useState } from "react";
import { Button, type ButtonProps } from "@mantine/core";
import { IconFileTypePdf } from "@tabler/icons-react";
import { apiDownload } from "@clients/apiClient";
import { notifyError } from "@utils/notify";

interface Props extends ButtonProps {
  /** Ruta de la API, p. ej. /sales/orders/:id/pdf */
  path: string;
  label?: string;
}

export default function PdfButton({ path, label = "PDF", ...rest }: Readonly<Props>) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await apiDownload(path);
    } catch (err) {
      notifyError(err, "No se pudo generar el PDF");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="xs" variant="default" leftSection={<IconFileTypePdf size={14} />} loading={busy} onClick={download} {...rest}>
      {label}
    </Button>
  );
}
