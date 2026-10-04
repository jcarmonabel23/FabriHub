/**
 * @project FabriHub - Front
 * @file src/global/store/Storage.ts
 * @description Almacenamiento cifrado (AES) para los stores persistidos de Zustand (patrón DaviHub)
 *
 * @overview
 * Lo persistido (perfil y módulos para pintar la UI al recargar) se guarda cifrado en
 * localStorage. Es una capa de ofuscación, NO el control de seguridad: la clave viaja en el
 * bundle. Por eso aquí nunca se guardan tokens: el access token vive solo en memoria y el
 * refresh token en una cookie httpOnly que JavaScript no puede leer.
 */

import CryptoJS from "crypto-js";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

const encryptionKey = import.meta.env.VITE_PUBLIC_ENCRIP_KEY ?? "fabrihub-dev-key";

const encryptedStorage: StateStorage = {
  getItem(name) {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const decrypted = CryptoJS.AES.decrypt(raw, encryptionKey).toString(CryptoJS.enc.Utf8);
      return decrypted || null;
    } catch {
      localStorage.removeItem(name);
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, CryptoJS.AES.encrypt(value, encryptionKey).toString());
    } catch {
      /* almacenamiento no disponible (modo privado): la app sigue sin persistir */
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* noop */
    }
  }
};

export const secureStorage = createJSONStorage(() => encryptedStorage);

/** Claves de todos los stores persistidos (para purgarlos al cerrar sesión) */
export const PERSISTED_STORE_KEYS = ["fabrihub-auth"] as const;

export function purgePersistedStores(): void {
  for (const key of PERSISTED_STORE_KEYS) encryptedStorage.removeItem(key);
}
