/**
 * @project FabriHub - Front
 * @file src/app/pos/store/cart.ts
 * @description Cuenta en curso de la caja (líneas, cliente y descuento global)
 *
 * Se guarda en el navegador para que una recarga no pierda la venta a medio cobrar. Pertenece a
 * un turno: si el turno cambia (otro cajero, otra caja, turno nuevo) la cuenta empieza vacía.
 * Precios, IVA y existencia NO se guardan aquí: los calcula el servidor en cada cotización.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartLine, CatalogItem, PosCustomer } from "../types";

interface CartState {
  sessionId: string | null;
  lines: CartLine[];
  customer: PosCustomer | null;
  discountPct: number;
  /** Vacía la cuenta si pertenece a otro turno */
  bindSession: (sessionId: string) => void;
  add: (item: CatalogItem, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  setLineDiscount: (productId: string, pct: number) => void;
  remove: (productId: string) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setDiscount: (pct: number) => void;
  clear: () => void;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      sessionId: null,
      lines: [],
      customer: null,
      discountPct: 0,
      bindSession: (sessionId) => {
        if (get().sessionId !== sessionId) set({ sessionId, lines: [], customer: null, discountPct: 0 });
      },
      add: (item, quantity = 1) =>
        set((s) => {
          const found = s.lines.find((l) => l.productId === item.id);
          if (found) {
            return { lines: s.lines.map((l) => (l.productId === item.id ? { ...l, quantity: round6(l.quantity + quantity), available: item.available } : l)) };
          }
          const line: CartLine = {
            productId: item.id,
            code: item.code,
            name: item.name,
            unitId: item.unitId,
            unitCode: item.unitCode,
            thumb: item.image?.thumb ?? null,
            quantity,
            discountPct: 0,
            available: item.available
          };
          return { lines: [...s.lines, line] };
        }),
      setQuantity: (productId, quantity) =>
        set((s) => ({
          lines: quantity > 0 ? s.lines.map((l) => (l.productId === productId ? { ...l, quantity: round6(quantity) } : l)) : s.lines.filter((l) => l.productId !== productId)
        })),
      setLineDiscount: (productId, pct) => set((s) => ({ lines: s.lines.map((l) => (l.productId === productId ? { ...l, discountPct: pct } : l)) })),
      remove: (productId) => set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) })),
      setCustomer: (customer) => set({ customer }),
      setDiscount: (pct) => set({ discountPct: pct }),
      clear: () => set({ lines: [], customer: null, discountPct: 0 })
    }),
    {
      name: "fabrihub-pos-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sessionId: s.sessionId, lines: s.lines, customer: s.customer, discountPct: s.discountPct })
    }
  )
);
