/**
 * @project FabriHub - Front
 * @file src/global/atoms/brand/Logo.tsx
 * @description Marca de FabriHub: isotipo (hexágono + F) y logotipo
 */

interface LogoMarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 40, className }: Readonly<LogoMarkProps>) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--color-brand-700)" />
      <path d="M32 12l17.3 10v20L32 52 14.7 42V22z" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
      <path d="M26 24h13M26 24v17M26 32h10" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 36, className = "" }: Readonly<LogoMarkProps>) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="FabriHub">
      <LogoMark size={size} />
      <span className="font-extrabold tracking-tight text-gray-900" style={{ fontSize: size * 0.62 }}>
        Fabri<span className="text-brand-700">Hub</span>
      </span>
    </span>
  );
}
