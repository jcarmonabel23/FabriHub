import { describe, expect, it } from "vitest";
import type { SessionModule } from "@auth/types";
import { can, canAccessModule, moduleForPath, visibleRoots } from "../moduleTree";

const mod = (code: string, parentCode: string | null, extra: Partial<SessionModule> = {}): SessionModule => ({
  code,
  name: code,
  description: null,
  icon: null,
  path: `/${code.toLowerCase().replace("_", "/")}`,
  parentCode,
  isPublic: false,
  isOffline: false,
  orderList: 0,
  permissions: [],
  ...extra
});

describe("moduleTree", () => {
  it("una hoja sin `access` no se puede usar aunque traiga otros permisos", () => {
    const m = mod("ADM_USERS", "ADMIN", { permissions: ["view", "edit"] });
    expect(canAccessModule(m)).toBe(false);
    expect(can(m, "edit")).toBe(false);
  });

  it("los módulos públicos no exigen asignación", () => {
    expect(canAccessModule(mod("DASHBOARD", null, { isPublic: true }))).toBe(true);
  });

  it("una raíz se ve si hay al menos una hoja accesible y se deshabilita si todas están fuera de servicio", () => {
    const modules = [
      mod("ADMIN", null, { path: "/admin" }),
      mod("ADM_USERS", "ADMIN", { permissions: ["access"] }),
      mod("INVENTORY", null, { path: "/inventory", isOffline: true }),
      mod("INV_PRODUCTS", "INVENTORY", { permissions: ["access"] }),
      mod("SALES", null, { path: "/sales" }),
      mod("SAL_ORDERS", "SALES", { permissions: [] })
    ];
    const cards = visibleRoots(modules);
    expect(cards.map((c) => c.module.code)).toEqual(["ADMIN", "INVENTORY"]);
    expect(cards.find((c) => c.module.code === "ADMIN")?.enabled).toBe(true);
    expect(cards.find((c) => c.module.code === "INVENTORY")?.offline).toBe(true);
  });

  it("moduleForPath elige el prefijo más largo", () => {
    const modules = [mod("ADMIN", null, { path: "/admin" }), mod("ADM_USERS", "ADMIN", { path: "/admin/users" })];
    expect(moduleForPath(modules, "/admin/users/123")?.code).toBe("ADM_USERS");
    expect(moduleForPath(modules, "/admin")?.code).toBe("ADMIN");
    expect(moduleForPath(modules, "/administrador")).toBeUndefined();
  });
});
