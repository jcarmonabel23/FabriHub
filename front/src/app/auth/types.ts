/**
 * @project FabriHub - Front
 * @file src/app/auth/types.ts
 * @description Modelos de sesión que devuelve la API (/auth/*)
 */

export interface SessionModule {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  path: string;
  parentCode: string | null;
  isPublic: boolean;
  isOffline: boolean;
  orderList: number;
  permissions: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
}

export interface SessionPayload {
  user: SessionUser;
  modules: SessionModule[];
  environment: string;
  idleMinutes: number;
}

export interface TokenPayload extends SessionPayload {
  accessToken: string;
  /** Epoch en segundos (claim exp del JWT) */
  accessExpiresAt: number;
}

export interface OtpChallenge {
  challengeId: string;
  otpExpiresAt: string;
  destination: string;
  resendAfterSeconds: number;
}
