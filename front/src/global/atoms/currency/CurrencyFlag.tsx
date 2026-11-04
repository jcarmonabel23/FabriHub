/**
 * @project FabriHub - Front
 * @file src/global/atoms/currency/CurrencyFlag.tsx
 * @description Bandera de la moneda de referencia (dólar: Estados Unidos; euro: Unión Europea), en SVG propio
 */

import type { ReactElement } from "react";

const W = 30;
const H = 20;

function UsFlag() {
  const stripe = H / 13;
  return (
    <>
      <rect width={W} height={H} fill="#fff" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} y={i * 2 * stripe} width={W} height={stripe} fill="#B22234" />
      ))}
      <rect width={W * 0.4} height={stripe * 7} fill="#3C3B6E" />
      {Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 5 }, (_, col) => <circle key={`${row}-${col}`} cx={1.4 + col * 2.4} cy={1.4 + row * 2.4} r={0.5} fill="#fff" />)
      )}
    </>
  );
}

function EuFlag() {
  return (
    <>
      <rect width={W} height={H} fill="#003399" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return <circle key={i} cx={W / 2 + 6 * Math.sin(a)} cy={H / 2 - 6 * Math.cos(a)} r={0.9} fill="#FFCC00" />;
      })}
    </>
  );
}

const FLAGS: Record<string, { label: string; draw: () => ReactElement }> = {
  USD: { label: "Estados Unidos", draw: UsFlag },
  EUR: { label: "Unión Europea", draw: EuFlag }
};

export default function CurrencyFlag({ code, size = 30 }: { code: string; size?: number }) {
  const flag = FLAGS[code];
  if (!flag) return null;
  return (
    <svg
      width={size}
      height={(size * H) / W}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Bandera de ${flag.label}`}
      className="shrink-0 rounded-sm ring-1 ring-black/10"
    >
      <flag.draw />
    </svg>
  );
}
