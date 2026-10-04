/**
 * @project FabriHub - Front
 * @file src/app/auth/services/auth.service.ts
 * @description Llamadas a /auth/* (las Lambdas auth/* de DaviHub)
 */

import { api } from "@clients/apiClient";
import type { OtpChallenge, SessionPayload, TokenPayload } from "../types";

export const signInRequest = (email: string, password: string) =>
  api<OtpChallenge>("/auth/sign-in", { method: "POST", body: { email, password }, skipAuth: true });

export const otpVerifyRequest = (challengeId: string, code: string) =>
  api<TokenPayload>("/auth/otp/verify", { method: "POST", body: { challengeId, code }, skipAuth: true });

export const otpResendRequest = (challengeId: string) =>
  api<{ otpExpiresAt: string; resendAfterSeconds: number }>("/auth/otp/resend", {
    method: "POST",
    body: { challengeId },
    skipAuth: true
  });

export const forgotPasswordRequest = (email: string) =>
  api<{ message: string; otpTtlMinutes: number }>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    skipAuth: true
  });

export const resetPasswordRequest = (email: string, code: string, newPassword: string) =>
  api<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: { email, code, newPassword },
    skipAuth: true
  });

export const changePasswordRequest = (currentPassword: string, newPassword: string) =>
  api<SessionPayload>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });

export const logoutAllRequest = () => api<void>("/auth/logout-all", { method: "POST", body: {} });
