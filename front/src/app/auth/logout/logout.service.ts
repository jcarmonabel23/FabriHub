/**
 * @project FabriHub - Front
 * @file src/app/auth/logout/logout.service.ts
 * @description Cierre de sesión: revoca en la API, purga stores y vuelve al login
 */

import { coreAuth } from "@auth/store/coreAuth";
import { purgePersistedStores } from "@store/Storage";

/** Revoca la sesión en el servidor (por cookie) y limpia todo rastro local */
export async function signOut(reason?: string): Promise<void> {
  try {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* aunque la red falle, la sesión local se limpia igual */
  }
  coreAuth.getState().resetAuth();
  purgePersistedStores();
  window.location.assign(reason ? `/auth/sign-in?reason=${encodeURIComponent(reason)}` : "/auth/sign-in");
}
