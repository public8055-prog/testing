"use client";
import { ResilientImage } from "@/components/ui/resilient-image";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { getService } from "@/lib/data";
import { useQuote } from "@/lib/use-quote";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/primitives";

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lines, setQty, remove, clear } = useCart();
  const router = useRouter();
  const returnFocus = useRef<HTMLElement | null>(null);

  const {quote,loading,error}=useQuote(open?lines:[]);
  const detailed = quote?.items||lines
    .map((l) => ({ ...l, s: getService(l.slug)! }))
    .filter((x) => x.s);

  const subtotal = detailed.reduce((a, l) => a + l.s.price * l.qty, 0);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-[2px]" />
      <Dialog.Content onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }} className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col bg-white shadow-2xl">
        <Dialog.Description className="sr-only">Review your selected services, change quantities, or continue to checkout.</Dialog.Description>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <Dialog.Title asChild>
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <ShoppingBag className="h-5 w-5" /> Your Cart
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
              {detailed.length} items
            </span>
          </h3>
          </Dialog.Title>
          <button onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 hover:bg-zinc-100" aria-label="Close cart">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {detailed.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-zinc-100">
                  <ShoppingBag className="h-7 w-7 text-zinc-400" />
                </div>
                <p className="font-bold text-zinc-900">Cart is empty</p>
                <p className="mb-4 text-sm text-zinc-500">Add home services to get started</p>
                <Button onClick={() => { onClose(); router.push("/#categories"); }}>
                  Browse services <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {detailed.map(({ slug, qty, s }) => (
                <div key={slug} className="flex gap-3 rounded-2xl border border-zinc-200 p-3">
                  <ResilientImage src={s.image} sizes="80px" alt={s.title} className="h-20 w-20 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{s.title}</p>
                    <p className="text-xs text-zinc-500">{s.durationMin} mins per service</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-1 py-0.5">
                        <button onClick={() => setQty(slug, qty - 1)} className="rounded-full p-1 hover:bg-zinc-100" aria-label={`Remove one ${s.title}`}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-5 text-center text-sm font-bold">{qty}</span>
                        <button onClick={() => setQty(slug, qty + 1)} className="rounded-full p-1 hover:bg-zinc-100" aria-label={`Add one ${s.title}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-sm font-extrabold">{formatINR(s.price * qty)}</p>
                    </div>
                  </div>
                  <button onClick={() => remove(slug)} className="self-start rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${s.title} from cart`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button onClick={clear} className="text-xs font-semibold text-zinc-400 hover:text-red-600">
                Clear cart
              </button>
            </div>
          )}
        </div>

        {detailed.length > 0 && (
          <div className="border-t border-zinc-100 px-5 py-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="font-bold">{formatINR(subtotal)}</span>
            </div>
            <p className="mb-3 text-xs text-emerald-600 font-semibold">{quote?quote.discount>0?`${formatINR(quote.discount)} checkout discount applied`:"Review itemised pricing at checkout":"Checking applicable pricing…"}</p>
            {loading&&<p role="status" className="mb-3 text-xs text-zinc-500">Checking current prices…</p>}
            {error&&<p role="alert" className="mb-3 text-xs text-red-600">{error} Open your cart to make changes.</p>}
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { onClose(); router.push("/cart"); }}>
                View cart
              </Button>
              <Button variant="brand" disabled={!quote||loading} onClick={() => { onClose(); router.push("/checkout"); }}>
                Checkout <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
