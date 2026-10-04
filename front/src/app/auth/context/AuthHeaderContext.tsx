/**
 * @project FabriHub - Front
 * @file src/app/auth/context/AuthHeaderContext.tsx
 * @description Título y descripción de la tarjeta de auth, fijados por cada página (patrón DaviHub)
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface AuthHeader {
  title: string;
  description: string;
}

interface Ctx {
  header: AuthHeader;
  setHeader: (h: AuthHeader) => void;
}

const AuthHeaderContext = createContext<Ctx | null>(null);

export function AuthHeaderProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [header, setHeader] = useState<AuthHeader>({ title: "Bienvenido", description: "" });
  return <AuthHeaderContext.Provider value={{ header, setHeader }}>{children}</AuthHeaderContext.Provider>;
}

export function useAuthHeaderValue(): AuthHeader {
  const ctx = useContext(AuthHeaderContext);
  if (!ctx) throw new Error("useAuthHeaderValue debe usarse dentro de AuthHeaderProvider");
  return ctx.header;
}

/** Cada página de auth declara su encabezado */
export function useAuthHeader(header: AuthHeader): void {
  const ctx = useContext(AuthHeaderContext);
  if (!ctx) throw new Error("useAuthHeader debe usarse dentro de AuthHeaderProvider");
  const { setHeader } = ctx;
  useEffect(() => {
    setHeader(header);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.title, header.description, setHeader]);
}
