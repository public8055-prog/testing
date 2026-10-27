"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingCart, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-store";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function BuyBox({ slug, price }: { slug: string; price: number }) {
  const [qty, setQty] = useState(1);
  const add = useCart((s) => s.add);
  const setStoreQty = useCart((s) => s.setQty);
  const lines = useCart((s) => s.lines);
  const router = useRouter();
  const inCart = lines.find((l) => l.slug === slug);

  const addMany = () => {
    for (let i = 0; i < qty; i++) add(slug);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 px-2 py-1.5">
          <button onClick={() => setQty(Math.max(1, qty - 1))} className="rounded-lg p-1.5 hover:bg-zinc-100 cursor-pointer" aria-label="Decrease quantity">
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-6 text-center font-semibold">{qty}</span>
          <button onClick={() => setQty(Math.min(10, qty + 1))} className="rounded-lg p-1.5 hover:bg-zinc-100 cursor-pointer" aria-label="Increase quantity">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-zinc-500">Total: <b className="text-zinc-900">{formatINR(price * qty)}</b></p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="lg"
          className="rounded-lg px-3 text-xs shadow-none"
          onClick={() => {
            if (inCart) setStoreQty(slug, inCart.qty + qty);
            else addMany();
          }}
        >
          <ShoppingCart className="h-4 w-4" /> Add to cart
        </Button>
        <Button
          variant="default"
          size="lg"
          className="rounded-lg px-3 text-xs shadow-none"
          onClick={() => {
            if (!inCart) addMany();
            router.push("/checkout");
          }}
        >
          <Zap className="h-4 w-4" /> Book now
        </Button>
      </div>
      {inCart && (
        <p className="mt-2 text-xs font-semibold text-violet-700">
          ✓ {inCart.qty} in your cart
        </p>
      )}
    </div>
  );
}

