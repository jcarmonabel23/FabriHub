/**
 * @project FabriHub - Front
 * @file src/app/dashboard/atoms/DashboardGridButtons.tsx
 * @description Tarjeta de módulo del tablero (misma forma que DaviHub, paleta petrol)
 */

import { Badge } from "@mantine/core";
import { ModuleIcon } from "@modules/icons/moduleIcons";

interface Props {
  name: string;
  description: string | null;
  icon: string | null;
  enabled?: boolean;
  badge?: string;
  onClick?: () => void;
}

export default function DashboardGridButtons({ name, description, icon, enabled = true, badge, onClick }: Readonly<Props>) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`relative flex flex-col items-center text-center p-6 rounded-xl border-2 transition-all duration-200 group w-full ${
        enabled
          ? "bg-white border-gray-100 hover:border-brand-200 hover:shadow-lg hover:-translate-y-1 cursor-pointer"
          : "bg-gray-50 border-gray-200 opacity-70 cursor-not-allowed"
      }`}
    >
      {badge && (
        <Badge size="xs" color="gray" variant="light" className="absolute top-2 right-2">
          {badge}
        </Badge>
      )}
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors ${
          enabled ? "bg-brand-50 text-brand-700 group-hover:bg-brand-700 group-hover:text-white" : "bg-gray-200 text-gray-500"
        }`}
      >
        <ModuleIcon icon={icon} size={28} />
      </div>
      <h3 className={`text-sm font-bold uppercase tracking-tight mb-1 ${enabled ? "text-gray-900" : "text-gray-500"}`}>{name}</h3>
      <p className={`text-xs leading-relaxed ${enabled ? "text-gray-500" : "text-gray-400"}`}>{description}</p>
    </button>
  );
}
