/**
 * @project FabriHub - Front
 * @file src/global/atoms/version/AppVersion.tsx
 * @description Marca de agua con versión y entorno
 */

import { APP_ENVIRONMENT, APP_VERSION, ENVIRONMENT_LABEL } from "@config/environment";

export default function AppVersion() {
  return (
    <div className="fixed bottom-2 right-3 text-[11px] text-gray-400 select-none pointer-events-none z-10">
      FabriHub v{APP_VERSION} · {ENVIRONMENT_LABEL[APP_ENVIRONMENT] ?? APP_ENVIRONMENT}
    </div>
  );
}
