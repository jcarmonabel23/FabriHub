/**
 * @project FabriHub - Front
 * @file src/app/auth/sign-in/hooks/useSignInLogic.ts
 * @description Estado y envío del login (paso 1: contraseña → desafío OTP)
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import { signInRequest } from "@auth/services/auth.service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useSignInLogic() {
  const navigate = useNavigate();
  const setChallenge = coreAuth((s) => s.setChallenge);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      setEmailError("Ingrese un correo válido");
      return;
    }
    setEmailError(null);
    setIsLoading(true);
    try {
      const challenge = await signInRequest(cleanEmail, password);
      setChallenge({ ...challenge, email: cleanEmail });
      navigate("/auth/otp-verify");
    } catch (err) {
      setPassword("");
      setFormError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setIsLoading(false);
    }
  };

  return { email, setEmail, password, setPassword, emailError, formError, isLoading, handleSubmit, navigate };
}
