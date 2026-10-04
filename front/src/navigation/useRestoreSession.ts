/**
 * @project FabriHub - Front
 * @file src/navigation/useRestoreSession.ts
 * @description Al recargar la página, recupera el access token con la cookie httpOnly
 *
 * El store persistido dice "había sesión", pero el access token no se persiste (vive en
 * memoria). Este hook pide uno nuevo una vez; si la cookie ya no sirve, limpia la sesión.
 */

import { useEffect } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { refreshSession } from "@clients/apiClient";
import { purgePersistedStores } from "@store/Storage";

export function useRestoreSession(): void {
  useEffect(() => {
    const { isAuthenticated, accessToken, setRestoring, resetAuth } = coreAuth.getState();
    if (!isAuthenticated || accessToken) return;
    setRestoring();
    refreshSession().catch(() => {
      resetAuth();
      purgePersistedStores();
    });
  }, []);
}
