import { describe, expect, it } from "vitest";
import { passwordIsValid } from "../passwordRules";

describe("passwordRules (espejo de la política de la API)", () => {
  it("acepta una contraseña que cumple todo", () => {
    expect(passwordIsValid("Fabri.Hub-2026!x", "admin@fabrihub.local")).toBe(true);
  });

  it.each([
    ["corta", "Ab1!"],
    ["sin mayúscula", "fabri.hub-2026!"],
    ["sin minúscula", "FABRI.HUB-2026!"],
    ["sin número", "Fabri.Hub-dos!x"],
    ["sin símbolo", "FabriHub2026x"]
  ])("rechaza: %s", (_case, password) => {
    expect(passwordIsValid(password)).toBe(false);
  });

  it("rechaza contraseñas que contienen el usuario del correo", () => {
    expect(passwordIsValid("Jcarmona#2026x", "jcarmona@fabrihub.local")).toBe(false);
  });
});
