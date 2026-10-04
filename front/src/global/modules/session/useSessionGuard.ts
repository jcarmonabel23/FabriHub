/**
 * @project FabriHub - Front
 * @file src/global/modules/session/useSessionGuard.ts
 * @description Guardián de sesión: inactividad y latido (equivalente a useCheckToken de DaviHub)
 *
 * @overview
 * - Inactividad: sin teclado/mouse/scroll durante `idleMinutes` (lo dicta la API) se cierra la
 *   sesión. Un minuto antes se avisa para que el usuario pueda seguir.
 * - Latido: mientras hay actividad, cada 4 min se renueva la sesión. Mantiene viva la sesión
 *   en el servidor (que también caduca por inactividad) y trae permisos frescos: si el admin
 *   le quita un módulo, el menú se actualiza en minutos sin volver a entrar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { refreshSession } from "@clients/apiClient";
import { signOut } from "@auth/logout/logout.service";

const HEARTBEAT_MS = 4 * 60 * 1000;
const WARNING_MS = 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

export function useSessionGuard(): { warning: boolean; secondsLeft: number; stayConnected: () => void } {
  const idleMinutes = coreAuth((s) => s.idleMinutes);
  const lastActivity = useRef(Date.now());
  const lastBeat = useRef(Date.now());
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const stayConnected = useCallback(() => {
    lastActivity.current = Date.now();
    setWarning(false);
    refreshSession().catch(() => undefined);
    lastBeat.current = Date.now();
  }, []);

  useEffect(() => {
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      lastActivity.current = now;
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });

    const idleMs = idleMinutes * 60 * 1000;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivity.current;

      if (idleFor >= idleMs) {
        window.clearInterval(timer);
        void signOut("SESSION_IDLE");
        return;
      }
      if (idleFor >= idleMs - WARNING_MS) {
        setWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil((idleMs - idleFor) / 1000)));
        return;
      }
      setWarning(false);
      if (now - lastBeat.current >= HEARTBEAT_MS && idleFor < HEARTBEAT_MS) {
        lastBeat.current = now;
        refreshSession().catch(() => undefined);
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
    };
  }, [idleMinutes]);

  return { warning, secondsLeft, stayConnected };
}
