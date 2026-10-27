import { ResilientImage } from "@/components/ui/resilient-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, CalendarDays, ArrowUpRight, Check } from "lucide-react";
import { readCategories, readServices } from "@/lib/db";
import { ServiceCard } from "@/components/site/service-card";
import { formatINR } from "@/lib/utils";
import { Reveal } from "@/components/motion/reveal";
import { CatalogUnavailable } from "@/components/service-detail/catalog-unavailable";
import { getServiceTheme, themeStyle } from "@/components/service-detail/themes";

export const dynamic = "force-dynamic";
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalog = await Promise.all([readCategories(), readServices(slug)]).catch(() => null);
  if (!catalog) return <CatalogUnavailable />;
  const [categories, list] = catalog;
  const cat = categories.find(c => c.slug === slug);
  if (!cat) notFound();
  const theme = getServiceTheme(slug);
  const Icon = theme.icon;
  const lowest = list.length ? Math.min(...list.map(s => s.price)) : null;
  return <div className="min-w-0 bg-white" style={themeStyle(slug)}><div className="mx-auto min-w-0 max-w-7xl px-5 py-8 sm:px-6">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><Link href="/">Home</Link><ChevronRight className="h-3 w-3" /><Link href="/search">Services</Link><ChevronRight className="h-3 w-3" /><span className="text-zinc-900">{cat.name}</span></nav>
    <Reveal className="service-surface mt-7 grid min-w-0 overflow-hidden rounded-3xl md:grid-cols-[1.1fr_1fr]"><div className="min-w-0 p-7 sm:p-10 lg:p-12"><span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] service-accent"><Icon className="h-4 w-4" />{cat.name}</span><h1 className="mt-5 max-w-md text-4xl font-semibold leading-[1.08] tracking-[-0.055em] lg:text-5xl">{theme.title}</h1><p className="mt-4 max-w-md text-sm leading-7 text-zinc-600">{theme.subtitle}</p><div className="mt-7 flex flex-wrap items-center gap-4"><a href="#services" className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-3 text-xs font-semibold text-white">Explore {list.length} services <ArrowRight className="h-3.5 w-3.5" /></a>{lowest !== null && <span className="text-xs text-zinc-600">From <b className="text-zinc-950">{formatINR(lowest)}</b></span>}</div></div><div className="relative min-w-0"><ResilientImage src={cat.image} sizes="(max-width:767px) 100vw, 50vw" alt={cat.name} className="h-60 w-full object-cover md:h-full md:max-h-[400px]" /><div className="absolute bottom-5 left-5 right-5 flex items-center gap-3 rounded-xl bg-white/95 p-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full service-surface service-accent"><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold">{theme.kicker}</p><p className="mt-1 text-[10px] text-zinc-500">Choose the scope that suits your home.</p></div></div></div></Reveal>
    <div id="services" className="service-section mt-10 grid min-w-0 gap-9 lg:grid-cols-[210px_minmax(0,1fr)]"><aside className="min-w-0"><div className="lg:sticky lg:top-28"><h2 className="text-xs font-semibold">Browse categories</h2><nav aria-label="Categories" className="mt-4 flex max-w-full min-w-0 gap-2 overflow-x-auto pb-2 no-scrollbar lg:flex-col">{categories.map(c => <Link key={c.slug} href={`/categories/${c.slug}`} aria-current={c.slug === slug ? "page" : undefined} className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-3 text-xs ${c.slug === slug ? "bg-zinc-950 font-semibold text-white" : "text-zinc-500 hover:bg-zinc-50"}`}>{c.name}<ArrowUpRight className="h-3.5 w-3.5 shrink-0" /></Link>)}</nav><div className="mt-7 hidden rounded-xl p-5 service-surface lg:block"><Icon className="h-6 w-6 service-accent" strokeWidth={1.5} /><h3 className="mt-4 text-xs font-semibold">Find your right fit</h3><ul className="mt-3 space-y-3 text-[11px] leading-5 text-zinc-600">{["Read the service inclusions", "Check the booking unit", "See what to prepare", "Choose your preferred slot"].map(t => <li key={t} className="flex gap-2"><Check className="mt-1 h-3 w-3 shrink-0 service-accent" />{t}</li>)}</ul></div></div></aside>
      <div className="min-w-0"><div className="mb-7 flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] service-accent">Care, your way</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{cat.name}</h2></div><span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><CalendarDays className="h-3.5 w-3.5" /> Select a slot at checkout</span></div>{list.length ? <div className="grid min-w-0 gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">{list.map((s, i) => <ServiceCard key={s.slug} s={s} index={i % 3} />)}</div> : <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center"><p className="text-sm text-zinc-500">Services in this category are coming soon.</p><Link href="/search" className="mt-4 inline-flex text-xs font-semibold text-violet-700">Explore other services</Link></div>}</div>
    </div>
  </div></div>;
}
