/**
 * @project FabriHub - Front
 * @file src/layouts/components/HeaderMain.tsx
 * @description Header superior (estructura DaviHub): logo a la izquierda; entorno, campana y usuario a la derecha
 *
 * Con identidad de empresa (fase 12): su logo reemplaza al de FabriHub y su color marca el borde inferior.
 */

import { Badge } from "@mantine/core";
import { Link } from "react-router-dom";
import { Logo } from "@atoms/brand/Logo";
import { coreAuth } from "@auth/store/coreAuth";
import { ENVIRONMENT_LABEL } from "@config/environment";
import ColorSchemeToggle from "./ColorSchemeToggle";
import CompanySwitcher from "./CompanySwitcher";
import NotificationBell from "./NotificationBell";
import UserProfileMenu from "./UserProfileMenu";

const ENV_COLOR: Record<string, string> = { dev: "orange", qa: "violet", prod: "teal" };

export default function HeaderMain() {
  const environment = coreAuth((s) => s.environment);
  const company = coreAuth((s) => s.company);
  return (
    <header
      className="h-16 px-4 bg-white border-b border-gray-200 sticky top-0 z-50 flex items-center justify-between"
      style={company?.brandColor ? { borderBottom: `3px solid ${company.brandColor}` } : undefined}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/dashboard" className="flex items-center shrink-0">
          {company?.logo ? (
            <img src={company.logo.header} alt={company.name} className="h-9 w-auto max-w-[180px] object-contain" />
          ) : (
            <Logo size={34} />
          )}
        </Link>
        <div className="w-px h-6 bg-gray-200 hidden sm:block" />
        <CompanySwitcher />
      </div>
      <div className="flex items-center gap-3">
        {environment !== "prod" && (
          <Badge color={ENV_COLOR[environment] ?? "gray"} variant="light" className="hidden sm:inline-flex">
            {ENVIRONMENT_LABEL[environment] ?? environment}
          </Badge>
        )}
        <ColorSchemeToggle />
        <NotificationBell />
        <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />
        <UserProfileMenu />
      </div>
    </header>
  );
}
