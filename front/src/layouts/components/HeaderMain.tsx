/**
 * @project FabriHub - Front
 * @file src/layouts/components/HeaderMain.tsx
 * @description Header superior (estructura DaviHub): logo a la izquierda, entorno y usuario a la derecha
 */

import { Badge } from "@mantine/core";
import { Link } from "react-router-dom";
import { Logo } from "@atoms/brand/Logo";
import { coreAuth } from "@auth/store/coreAuth";
import { ENVIRONMENT_LABEL } from "@config/environment";
import UserProfileMenu from "./UserProfileMenu";

const ENV_COLOR: Record<string, string> = { dev: "orange", qa: "violet", prod: "teal" };

export default function HeaderMain() {
  const environment = coreAuth((s) => s.environment);
  return (
    <header className="h-16 px-4 bg-white border-b border-gray-200 sticky top-0 z-50 flex items-center justify-between">
      <Link to="/dashboard" className="flex items-center">
        <Logo size={34} />
      </Link>
      <div className="flex items-center gap-3">
        {environment !== "prod" && (
          <Badge color={ENV_COLOR[environment] ?? "gray"} variant="light" className="hidden sm:inline-flex">
            {ENVIRONMENT_LABEL[environment] ?? environment}
          </Badge>
        )}
        <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />
        <UserProfileMenu />
      </div>
    </header>
  );
}
