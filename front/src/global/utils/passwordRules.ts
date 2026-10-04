/**
 * @project FabriHub - Front
 * @file src/global/utils/passwordRules.ts
 * @description Reglas de contraseña para el checklist en vivo. Son ESPEJO de api/src/lib/passwords.ts:
 * aquí solo guían al usuario; la que decide es la API.
 */

export interface PasswordRule {
  label: string;
  test: (password: string, email?: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: "Al menos 10 caracteres", test: (p) => p.length >= 10 },
  { label: "Una letra mayúscula", test: (p) => /[A-Z]/.test(p) },
  { label: "Una letra minúscula", test: (p) => /[a-z]/.test(p) },
  { label: "Un número", test: (p) => /\d/.test(p) },
  { label: "Un símbolo", test: (p) => /[^A-Za-z0-9]/.test(p) },
  {
    label: "No contiene su usuario de correo",
    test: (p, email) => {
      const local = email?.split("@")[0]?.toLowerCase();
      return !local || local.length < 3 || !p.toLowerCase().includes(local);
    }
  }
];

export const passwordIsValid = (password: string, email?: string): boolean =>
  PASSWORD_RULES.every((r) => r.test(password, email));
