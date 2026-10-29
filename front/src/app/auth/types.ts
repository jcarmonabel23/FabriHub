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
  /** Administra la plataforma: empresas, roles, módulos y datos globales */
  isPlatformAdmin?: boolean;
}

/** Empresa activa de la sesión (con su identidad; las listas de empresas no la traen) */
export interface SessionCompany extends Partial<CompanyBranding> {
  id: string;
  code: string;
  name: string;
}

/** Identidad de la empresa activa (URLs firmadas: vencen en horas y se renuevan con cada refresh) */
export interface CompanyBranding {
  brandColor: string | null;
  logo: { header: string; doc: string } | null;
  icon: { favicon: string; app: string } | null;
}

/** Empresa a la que pertenece el usuario (selector de la cabecera) */
export interface MyCompany extends SessionCompany {
  rif: string;
  isDefault: boolean;
  isCurrent: boolean;
}

export interface SessionPayload {
  user: SessionUser;
  company: SessionCompany | null;
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
