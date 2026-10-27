"use client";
import { ResilientImage } from "@/components/ui/resilient-image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Minus, Clock3 } from "lucide-react";
import type { Service } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { useCart } from "@/lib/cart-store";
import {useAccountSession} from "./session-provider";

export function ServiceCard({ s, index = 0 }: { s: Service; index?: number }) {
  const reduced = useReducedMotion();
  const {catalogOnly}=useAccountSession();
  const add = useCart(st => st.add);
  const setQty = useCart(st => st.setQty);
  const qty = useCart(st => st.lines.find(l => l.slug === s.slug)?.qty ?? 0);
  return <motion.article initial={false} whileInView={reduced !== false ? undefined : { opacity: [0.7, 1], y: [14, 0] }} whileHover={reduced !== false ? undefined : { y: -3 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.35, delay: Math.min(index, 3) * 0.05 }} className="group flex h-full flex-col rounded-xl bg-white">
    <Link href={`/services/${s.slug}`} className="relative block aspect-[1.4] overflow-hidden rounded-xl bg-zinc-100"><ResilientImage src={s.image} sizes="(max-width:639px) calc(100vw - 40px), (max-width:1023px) 45vw, 280px" alt={s.title} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-[10px] font-medium text-zinc-700"><Clock3 className="h-3 w-3" /> {s.durationMin} min</span></Link>
    <div className="flex flex-1 flex-col pt-4"><Link href={`/services/${s.slug}`}><h3 className="min-h-10 text-[15px] font-semibold leading-5 tracking-[-0.015em] text-zinc-900 hover:text-violet-700">{s.title}</h3></Link><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{s.description}</p><div className="mt-auto flex items-center justify-between gap-2 pt-4"><div><p className="max-w-[160px] text-[10px] leading-4 text-zinc-500">{s.bookingUnit || "Per service"}</p><span className="text-base font-semibold">{formatINR(s.price)}</span></div>{catalogOnly ? <Link href={`/services/${s.slug}`} className="inline-flex min-h-11 items-center rounded-lg border border-teal-300 px-4 text-xs font-semibold text-teal-900">View details</Link> : qty > 0 ? <div className="flex h-9 items-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700"><button onClick={() => setQty(s.slug, qty - 1)} aria-label={`Remove one ${s.title}`} className="grid h-9 w-8 cursor-pointer place-items-center hover:bg-violet-100"><Minus className="h-3.5 w-3.5" /></button><span aria-live="polite" className="min-w-5 text-center text-xs font-semibold">{qty}</span><button onClick={() => add(s.slug)} aria-label={`Add one ${s.title}`} className="grid h-9 w-8 cursor-pointer place-items-center hover:bg-violet-100"><Plus className="h-3.5 w-3.5" /></button></div> : <button onClick={() => add(s.slug)} aria-label={`Add ${s.title} to cart`} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-xs font-semibold text-violet-700 transition hover:bg-violet-50">Add <Plus className="h-3.5 w-3.5" /></button>}</div></div>
  </motion.article>;
}


