/**
 * @project FabriHub - Front
 * @file src/global/modules/access-control/Can.tsx
 * @description Render condicional por permiso: <Can module="ADM_USERS" perform="add_new">…</Can>
 */

import type { ReactNode } from "react";
import { useCan } from "./useCan";

interface CanProps {
  module: string;
  perform: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export default function Can({ module, perform, children, fallback = null }: Readonly<CanProps>) {
  const can = useCan(module);
  return <>{can(perform) ? children : fallback}</>;
}
