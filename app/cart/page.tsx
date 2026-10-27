"use client";
import { ResilientImage } from "@/components/ui/resilient-image";

import Link from "next/link";
import { Minus, Plus, Trash2, ArrowRight, ReceiptText, Tag } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { getService } from "@/lib/data";
import { useQuote } from "@/lib/use-quote";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Separator } from "@/components/ui/primitives";

export default function CartPage() {
  const { lines, setQty, remove, clear } = useCart();
  const {quote,loading,error}=useQuote(lines);
  const detailed = quote?.items||lines.map((l) => ({ ...l, s: getService(l.slug)! })).filter((x) => x.s);
  const subtotal = quote?.subtotal||0;
  const mrp = detailed.reduce((a, l) => a + l.s.mrp * l.qty, 0);
  const savings = quote?Math.max(0,mrp - subtotal)+quote.discount:0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>
      <p className="mt-1 text-sm text-zinc-500">{detailed.length} service{detailed.length !== 1 && "s"} · current prices and applicable fees below</p>
      {loading&&<p role="status" className="mt-4 text-sm text-zinc-500">Checking current prices…</p>}
      {error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {detailed.length === 0 ? (
        <Card className="mt-6 p-12 text-center">
          <p className="text-lg font-semibold">Cart is empty</p>
          <p className="mt-1 text-sm text-zinc-500">Find a little care for your home.</p>
          <Link href="/#categories"><Button variant="default" className="mt-4">Browse services <ArrowRight className="h-4 w-4" /></Button></Link>
        </Card>
      ) : (
        <div className="mt-6 gap-8 lg:grid lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {detailed.map(({ slug, qty, s }) => (
              <Card key={slug} className="flex gap-4 p-4">
                <Link href={`/services/${s.slug}`}>
                  <ResilientImage src={s.image} sizes="(min-width:640px) 112px, 96px" alt={s.title} className="h-24 w-24 rounded-xl object-cover sm:h-28 sm:w-28" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/services/${s.slug}`} className="font-semibold hover:text-violet-700">{s.title}</Link>
                  <p className="text-xs text-zinc-500">{s.durationMin} minutes · At your home</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-1.5 py-1">
                      <button onClick={() => setQty(slug, qty - 1)} className="rounded-full p-1 hover:bg-zinc-100 cursor-pointer" aria-label={`Remove one ${s.title}`}><Minus className="h-4 w-4" /></button>
                      <span className="min-w-6 text-center text-sm font-semibold">{qty}</span>
                      <button onClick={() => setQty(slug, qty + 1)} className="rounded-full p-1 hover:bg-zinc-100 cursor-pointer" aria-label={`Add one ${s.title}`}><Plus className="h-4 w-4" /></button>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatINR(s.price * qty)}</p>
                      <p className="text-xs text-zinc-400 line-through">{formatINR(s.mrp * qty)}</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => remove(slug)} className="self-start rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 cursor-pointer" aria-label={`Remove ${s.title} from cart`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            ))}
            <button onClick={clear} className="text-xs font-bold text-zinc-400 hover:text-red-600 cursor-pointer">Clear cart</button>
          </div>

          <aside className="mt-6 lg:mt-0">
            <Card className="p-6 lg:sticky lg:top-32">
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2.5 text-[13px] font-bold text-violet-700">
                <Tag className="h-4 w-4" /> You save {formatINR(savings)} on this order
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <p className="flex justify-between"><span className="text-zinc-500">Subtotal (MRP)</span><span className="line-through text-zinc-400">{formatINR(mrp)}</span></p>
                <p className="flex justify-between"><span className="text-zinc-500">Service total</span><b>{formatINR(subtotal)}</b></p>
                <p className="flex justify-between text-violet-700"><span>Checkout discount</span><b>{quote?`− ${formatINR(quote.discount)}`:"—"}</b></p>
                <p className="flex justify-between"><span className="text-zinc-500">Visit fee</span><b>{quote?quote.visitFee===0?"No fee":formatINR(quote.visitFee):"—"}</b></p>
              </div>
              <Separator className="my-4" />
              <p className="flex justify-between text-base font-bold"><span>To pay</span><span>{quote?formatINR(quote.total):"—"}</span></p>
              {quote&&<p className="mt-2 text-xs text-zinc-500">Estimated service time: {quote.durationMin} minutes</p>}
              {quote?<Link href="/checkout"><Button variant="default" size="lg" className="mt-4 w-full rounded-lg text-sm shadow-none">Proceed to checkout <ArrowRight className="h-4 w-4" /></Button></Link>:<Button disabled className="mt-4 w-full">{loading?"Checking prices…":"Update your cart to continue"}</Button>}
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-zinc-500"><ReceiptText className="h-3.5 w-3.5 text-violet-700" /> Review your final details at checkout</p>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

