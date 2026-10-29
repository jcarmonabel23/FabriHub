/**
 * @project FabriHub - Front
 * @file src/layouts/components/useCompanyFavicon.ts
 * @description Usa el ícono de la empresa activa como favicon mientras dure la sesión
 */

import { useEffect } from "react";
import { coreAuth } from "@auth/store/coreAuth";

export function useCompanyFavicon(): void {
  const favicon = coreAuth((s) => s.company?.icon?.favicon ?? null);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || !favicon) return;
    const original = { href: link.getAttribute("href") ?? "/favicon.svg", type: link.type };
    link.type = "image/png";
    link.href = favicon;
    // Al salir del layout autenticado (cierre de sesión) vuelve el de FabriHub
    return () => {
      link.type = original.type;
      link.href = original.href;
    };
  }, [favicon]);
}
