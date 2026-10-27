"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, ArrowRight, X } from "lucide-react";
import Link from "next/link";
import type { Category, Service } from "@/lib/types";
import { ServiceCard } from "@/components/site/service-card";
import { Reveal } from "@/components/motion/reveal";

export function CatalogResults({ services, categories, initialQuery = "", initialCategory = "all" }: { services: Service[]; categories: Category[]; initialQuery?: string; initialCategory?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [sort, setSort] = useState("recommended");
  const [budget, setBudget] = useState("all");
  const out = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const list = services.filter(s => (category === "all" || s.category === category) && (budget === "all" || s.price <= Number(budget)) && words.every(word => `${s.title} ${s.description} ${s.category} ${s.includes.join(" ")}`.toLowerCase().includes(word)));
    if (sort === "price-low") list.sort((a, b) => a.price - b.price);
    if (sort === "price-high") list.sort((a, b) => b.price - a.price);
    if (sort === "duration") list.sort((a, b) => a.durationMin - b.durationMin);
    return list;
  }, [services, query, category, sort, budget]);
  const reset = () => { setQuery(""); setCategory("all"); setBudget("all"); };
  const filtered = !!query || category !== "all" || budget !== "all";
  return <div className="mx-auto max-w-7xl px-5 py-10 sm:px-6 sm:py-14">
    <Reveal className="flex flex-wrap items-end justify-between gap-6"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">Find your kind of care</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Home services, sorted.</h1><p className="mt-4 max-w-xl text-sm leading-7 text-zinc-500">A quick fix, a fresh space or a little time for yourself. Explore {services.length} services with clear details and prices.</p></div><span className="rounded-xl border border-zinc-200 bg-white px-5 py-4 text-xs text-zinc-500"><b className="text-xl font-semibold text-zinc-950">{categories.length}</b> categories. One place.</span></Reveal>
    <div className="mt-9 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input aria-label="Search the service catalog" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search for cleaning, AC, salon and more" className="h-12 w-full rounded-lg border border-zinc-200 bg-white pl-11 pr-10 text-sm outline-none focus:border-violet-400" />{query && <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400"><X className="h-4 w-4" /></button>}</div><div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3"><SlidersHorizontal className="h-4 w-4 text-zinc-500" /><select aria-label="Sort services" value={sort} onChange={e => setSort(e.target.value)} className="h-12 bg-transparent pr-2 text-xs outline-none"><option value="recommended">Browse services</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="duration">Shortest duration</option></select></div></div>
    <div aria-label="Filter by category" className="mt-5 flex flex-wrap gap-2">{[{ slug: "all", name: "All services" }, ...categories].map(c => <button key={c.slug} onClick={() => setCategory(c.slug)} aria-pressed={category === c.slug} className={`cursor-pointer rounded-full border px-4 py-2 text-xs transition ${category === c.slug ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-500"}`}>{c.name}</button>)}</div>
    <div className="mb-7 mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 pt-6"><p className="text-xs text-zinc-500" aria-live="polite">{out.length} services available{query ? ` for “${query}”` : ""}</p><div className="flex items-center gap-4"><label className="flex items-center gap-2 text-xs text-zinc-500">Budget<select aria-label="Filter by maximum price" value={budget} onChange={e => setBudget(e.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700"><option value="all">Any price</option><option value="500">Up to ₹500</option><option value="1000">Up to ₹1,000</option><option value="2500">Up to ₹2,500</option></select></label>{filtered && <button onClick={reset} className="cursor-pointer text-xs font-medium text-violet-700">Reset</button>}</div></div>
    {out.length === 0 ? <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-16 text-center"><Search className="mx-auto h-8 w-8 text-zinc-300" /><h2 className="mt-4 text-lg font-semibold">{services.length ? "Let’s try another search" : "New services are on the way"}</h2><p className="mt-2 text-sm text-zinc-500">{services.length ? "Try a broader service name or adjust your budget." : "Check back soon to explore the catalog."}</p>{filtered && <button onClick={reset} className="mt-5 cursor-pointer rounded-lg bg-zinc-950 px-5 py-3 text-xs font-semibold text-white">Clear filters</button>}</div> : <section aria-labelledby="catalog-results-heading"><h2 id="catalog-results-heading" className="mb-5 text-lg font-semibold">Available services</h2><div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">{out.map((s, i) => <ServiceCard key={s.slug} s={s} index={i % 4} />)}</div></section>}
    <div className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-violet-50 p-6"><div><h2 className="text-sm font-semibold">Already have a booking?</h2><p className="mt-1 text-xs text-zinc-600">Your details and status are in one place.</p></div><Link href="/bookings" className="flex items-center gap-2 text-xs font-semibold text-violet-700">View my bookings <ArrowRight className="h-4 w-4" /></Link></div>
  </div>;
}
