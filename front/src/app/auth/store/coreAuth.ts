/**
 * @project FabriHub - Front
 * @file src/app/auth/store/coreAuth.ts
 * @description Store de sesión (Zustand) — mismo nombre y papel que en DaviHub
 *
 * @overview
 * - `accessToken` vive SOLO en memoria (no se persiste): un XSS no lo encuentra en disco y al
 *   cerrar la pestaña desaparece. Al recargar, `restoring` pide uno nuevo con la cookie httpOnly.
 * - Se persiste cifrado lo necesario para pintar la UI sin parpadeo: perfil y módulos.
 * - `challenge` guarda el desafío OTP entre la pantalla de login y la de verificación.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureStorage } from "@store/Storage";
import type { OtpChallenge, SessionModule, SessionPayload, SessionUser, TokenPayload } from "../types";

export type SessionStatus = "anonymous" | "restoring" | "authenticated";

interface AuthState {
  status: SessionStatus;
  isAuthenticated: boolean;
  accessToken: string | null;
  accessExpiresAt: number | null;
  user: SessionUser | null;
  modules: SessionModule[];
  environment: string;
  idleMinutes: number;
  challenge: (OtpChallenge & { email: string }) | null;

  setTokens: (payload: TokenPayload) => void;
  setSession: (payload: SessionPayload) => void;
  setChallenge: (challenge: (OtpChallenge & { email: string }) | null) => void;
  setRestoring: () => void;
  resetAuth: () => void;
}

const empty = {
  status: "anonymous" as SessionStatus,
  isAuthenticated: false,
  accessToken: null,
  accessExpiresAt: null,
  user: null,
  modules: [],
  environment: "dev",
  idleMinutes: 30,
  challenge: null
};

export const coreAuth = create<AuthState>()(
  persist(
    (set) => ({
      ...empty,

      setTokens: (p) =>
        set({
          status: "authenticated",
          isAuthenticated: true,
          accessToken: p.accessToken,
          accessExpiresAt: p.accessExpiresAt,
          user: p.user,
          modules: p.modules,
          environment: p.environment,
          idleMinutes: p.idleMinutes,
          challenge: null
        }),

      setSession: (p) => set({ user: p.user, modules: p.modules, environment: p.environment, idleMinutes: p.idleMinutes }),

      setChallenge: (challenge) => set({ challenge }),

      setRestoring: () => set({ status: "restoring" }),

      resetAuth: () => set({ ...empty })
    }),
    {
      name: "fabrihub-auth",
      storage: secureStorage,
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        user: s.user,
        modules: s.modules,
        environment: s.environment,
        idleMinutes: s.idleMinutes
      })
    }
  )
);
