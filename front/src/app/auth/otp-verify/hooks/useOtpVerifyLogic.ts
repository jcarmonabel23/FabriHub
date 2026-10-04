/**
 * @project FabriHub - Front
 * @file src/app/auth/otp-verify/hooks/useOtpVerifyLogic.ts
 * @description Verificación OTP (paso 2): valida, reenvía con espera y abre la sesión
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import { otpResendRequest, otpVerifyRequest } from "@auth/services/auth.service";
import { DEFAULT_REDIRECT_AUTHENTICATED } from "@navigation/routes.config";

/** Estos errores invalidan el desafío: hay que volver a la contraseña */
const TERMINAL = new Set(["OTP_EXPIRED", "OTP_LOCKED", "OTP_MAX_SENDS"]);

export function useOtpVerifyLogic() {
  const navigate = useNavigate();
  const location = useLocation();
  const challenge = coreAuth((s) => s.challenge);
  const setChallenge = coreAuth((s) => s.setChallenge);
  const setTokens = coreAuth((s) => s.setTokens);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [resendAt, setResendAt] = useState(() => Date.now() + (challenge?.resendAfterSeconds ?? 30) * 1000);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const expiresIn = challenge ? Math.max(0, Math.floor((new Date(challenge.otpExpiresAt).getTime() - now) / 1000)) : 0;
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const verify = async (value: string) => {
    if (!challenge || value.length !== 6) return;
    setIsLoading(true);
    setError(null);
    try {
      const session = await otpVerifyRequest(challenge.challengeId, value);
      setTokens(session);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(session.user.mustChangePassword ? "/auth/change-password" : from || DEFAULT_REDIRECT_AUTHENTICATED, {
        replace: true
      });
    } catch (err) {
      setCode("");
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? "No se pudo verificar el código");
      if (apiErr && TERMINAL.has(apiErr.code)) setTerminal(true);
    } finally {
      setIsLoading(false);
    }
  };

  const resend = async () => {
    if (!challenge) return;
    setIsResending(true);
    setError(null);
    try {
      const r = await otpResendRequest(challenge.challengeId);
      setChallenge({ ...challenge, otpExpiresAt: r.otpExpiresAt, resendAfterSeconds: r.resendAfterSeconds });
      setResendAt(Date.now() + r.resendAfterSeconds * 1000);
      setCode("");
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? "No se pudo reenviar el código");
      if (apiErr && TERMINAL.has(apiErr.code)) setTerminal(true);
    } finally {
      setIsResending(false);
    }
  };

  const backToSignIn = () => {
    setChallenge(null);
    navigate("/auth/sign-in", { replace: true });
  };

  return {
    challenge,
    code,
    setCode,
    verify,
    resend,
    error,
    terminal,
    isLoading,
    isResending,
    expiresIn,
    resendIn,
    backToSignIn
  };
}
