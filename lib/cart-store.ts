"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartLine = { slug: string; qty: number };

type CartState = {
  lines: CartLine[];
  add: (slug: string) => void;
  remove: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  clear: () => void;
  count: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      add: (slug: string) =>
        set((s) => {
          const ex = s.lines.find((l) => l.slug === slug);
          if (ex)
            return {
              lines: s.lines.map((l) =>
                l.slug === slug ? { ...l, qty: Math.min(10,l.qty + 1) } : l
              ),
            };
          return { lines: [...s.lines, { slug, qty: 1 }] };
        }),
      remove: (slug: string) =>
        set((s) => ({ lines: s.lines.filter((l) => l.slug !== slug) })),
      setQty: (slug: string, qty: number) =>
        set((s) =>
          qty <= 0
            ? { lines: s.lines.filter((l) => l.slug !== slug) }
            : {
                lines: s.lines.map((l) =>
                  l.slug === slug ? { ...l, qty:Math.max(1,Math.min(10,Math.floor(qty))) } : l
                ),
              }
        ),
      clear: () => set({ lines: [] }),
      count: () => get().lines.reduce((a, l) => a + l.qty, 0),
    }),
    {
      name: "urbanhome-cart",
      skipHydration: true,
      partialize: (state) => ({ lines: state.lines }),
      merge: (persisted, current) => {
        const stored = (persisted as { lines?: CartLine[] } | null)?.lines;
        const seen = new Set<string>();
        const lines = Array.isArray(stored) ? stored.filter(line => {
          if (!line || typeof line.slug !== "string" || !Number.isFinite(line.qty) || line.qty < 1 || seen.has(line.slug)) return false;
          seen.add(line.slug);return true;
        }).slice(0,20).map(line => ({ slug:line.slug,qty:Math.min(10,Math.floor(line.qty)) })) : [];
        return { ...current, lines };
      },
    }
  )
);
