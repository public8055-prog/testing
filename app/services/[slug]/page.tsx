import { ResilientImage } from "@/components/ui/resilient-image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readMarketplaceCategories } from "@/lib/marketplace-categories";
import { ArrowDown, ArrowUpRight, ChevronRight, Clock3, Check, MapPin, CalendarDays, ReceiptText, ClipboardList, Minus, ArrowRight } from "lucide-react";
import { getCatalogService, readCategories, readServices } from "@/lib/db";
import { formatINR } from "@/lib/utils";
import { ServiceCard } from "@/components/site/service-card";
import { BuyBox } from "@/components/pdp/buy-box";
import { Reveal } from "@/components/motion/reveal";
import { getServiceTheme, themeStyle } from "@/components/service-detail/themes";
import { CatalogUnavailable } from "@/components/service-detail/catalog-unavailable";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const service = await getCatalogService((await params).slug).catch(() => null);
  return { title: service ? `${service.title} | SanjuNow` : "Home services | SanjuNow", description: service?.description };
}

export default async function ServicePDP({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if ((await readMarketplaceCategories()).some(category => category.slug === slug)) redirect(`/services?category=${encodeURIComponent(slug)}`);
  const result = await Promise.all([getCatalogService(slug), readCategories()]).catch(() => null);
  if (!result) return <CatalogUnavailable />;
  const [s, categories] = result;
  if (!s) notFound();
  const cat = categories.find(c => c.slug === s.category);
  const related = (await readServices(s.category).catch(() => [])).filter(x => x.slug !== slug).slice(0, 4);
  const theme = getServiceTheme(s.category);
  const Icon = theme.icon;
  const details = s as typeof s & { bookingUnit?: string; preparation?: string[]; exclusions?: string[]; serviceSteps?: { title: string; description: string }[] };
  const preparation = details.preparation?.length ? details.preparation : ["Keep the service area accessible.", "Share any specific concerns before work begins.", "Keep your booking confirmation and contact number handy."];
  const exclusions = details.exclusions?.length ? details.exclusions : ["Work beyond the inclusions listed on this page.", "Additional materials or parts unless explicitly included."];
  const steps = details.serviceSteps?.length ? details.serviceSteps : [
    { title: "Talk through the details", description: "Review your selected service and share the areas that need attention." },
    { title: "Work through the scope", description: "The visit focuses on the tasks listed in your service inclusions." },
    { title: "Review the result", description: "Check the work together and discuss any recommended next steps." },
  ];
  const unit = details.bookingUnit || "per service";
  const wellness = theme.kind === "wellness";
  return <div className="bg-white pb-6" style={themeStyle(s.category)}>
    <div className="mx-auto max-w-7xl px-5 pt-7 sm:px-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><Link href="/">Home</Link><ChevronRight className="h-3 w-3" />{cat && <><Link href={`/categories/${cat.slug}`}>{cat.name}</Link><ChevronRight className="h-3 w-3" /></>}<span className="text-zinc-900">{s.title}</span></nav>
      <Reveal className={`mt-7 grid items-center gap-8 overflow-hidden rounded-3xl p-5 sm:p-8 lg:gap-12 lg:p-10 service-surface ${wellness ? "md:grid-cols-[0.9fr_1.1fr]" : "md:grid-cols-2"}`}>
        <div className={wellness ? "md:order-last" : ""}>
          <span className="mb-5 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] service-accent"><Icon className="h-4 w-4" strokeWidth={1.6} />{theme.kicker}</span>
          <h1 className={`text-3xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-4xl lg:text-[46px] ${wellness ? "max-w-md" : "max-w-lg"}`}>{s.title}</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-zinc-600">{s.description}</p>
          <div className="mt-6 flex flex-wrap gap-2.5"><span className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-2 text-[11px] text-zinc-700"><Clock3 className="h-3.5 w-3.5" />About {s.durationMin} minutes</span><span className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-2 text-[11px] text-zinc-700"><MapPin className="h-3.5 w-3.5" />At your home</span></div>
          <a href="#included" className="mt-7 inline-flex items-center gap-2 text-xs font-semibold service-accent">Explore the details <ArrowDown className="h-3.5 w-3.5" /></a>
        </div>
        <div className={`relative h-64 overflow-hidden sm:h-[350px] lg:h-[380px] ${wellness ? "rounded-t-[140px] rounded-b-2xl md:order-first" : "rounded-2xl"}`}>
          <ResilientImage src={s.image} sizes="(max-width:767px) 100vw, 50vw" alt={s.title} fetchPriority="high" className="h-full w-full object-cover" />
          <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-xl bg-white/95 px-4 py-3 backdrop-blur-sm"><div><p className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">{cat?.name || "Home care"}</p><p className="mt-1 text-xs font-semibold">{wellness ? "Your space. Your moment." : theme.kind === "project" ? "A thoughtful finishing touch." : "Care in the details."}</p></div><Icon className="h-6 w-6 shrink-0 service-accent" strokeWidth={1.4} /></div>
        </div>
      </Reveal>
    </div>
    <nav aria-label="Service details" className="service-detail-nav sticky top-[81px] z-20 mt-8 border-y border-zinc-200 bg-white/95 backdrop-blur-sm"><div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 py-2 no-scrollbar sm:gap-3 sm:px-6">{[{ id: "included", t: "What’s included" }, { id: "process", t: "The experience" }, { id: "prepare", t: "Before your visit" }, { id: "faqs", t: "FAQs" }].map(a => <a key={a.id} href={`#${a.id}`} className="shrink-0 rounded-lg px-3 py-3 text-xs font-medium text-zinc-600">{a.t}</a>)}</div></nav>
    <div className="mx-auto grid max-w-7xl gap-9 px-5 py-9 sm:px-6 lg:grid-cols-[1fr_350px] lg:gap-14">
      <div className="min-w-0">
        <Reveal><section id="included" className="service-section"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] service-accent">01 / The scope</p><h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">{theme.scope}</h2><p className="mt-2 text-xs leading-6 text-zinc-500">Booking unit: {unit}. Here&apos;s what to expect.</p><ul className="mt-6 grid gap-3 sm:grid-cols-2">{s.includes.map(inc => <li key={inc} className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-xs leading-6 text-zinc-700"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full service-surface service-accent"><Check className="h-3.5 w-3.5" /></span>{inc}</li>)}</ul><div className="mt-5 rounded-xl bg-zinc-50 p-5"><h3 className="text-xs font-semibold">Outside this service</h3><ul className="mt-3 space-y-2">{exclusions.map(x => <li key={x} className="flex gap-2 text-xs leading-6 text-zinc-500"><Minus className="mt-1.5 h-3 w-3 shrink-0" />{x}</li>)}</ul></div></section></Reveal>
        <Reveal><section id="process" className="service-section mt-12"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] service-accent">02 / The experience</p><h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">{theme.process}</h2><ol className={`mt-7 ${wellness ? "space-y-4" : "grid gap-4 sm:grid-cols-3"}`}>{steps.map((step, i) => <li key={`${i}-${step.title}`} className={`rounded-2xl border border-zinc-200 p-5 ${wellness ? "flex gap-5" : ""}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold service-surface service-accent">{String(i + 1).padStart(2, "0")}</span><div><h3 className={`${wellness ? "mt-1" : "mt-5"} text-sm font-semibold`}>{step.title}</h3><p className="mt-2 text-xs leading-6 text-zinc-500">{step.description}</p></div></li>)}</ol></section></Reveal>
        <Reveal><section id="prepare" className="service-section mt-12 grid gap-6 rounded-2xl p-6 service-surface sm:grid-cols-[48px_1fr] sm:p-8"><ClipboardList className="h-9 w-9 service-accent" strokeWidth={1.4} /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] service-accent">03 / Before your visit</p><h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">A little preparation helps.</h2><ul className="mt-5 space-y-3">{preparation.map((p, i) => <li key={p} className="flex gap-3 text-xs leading-6 text-zinc-600"><span className="font-semibold service-accent">{i + 1}.</span>{p}</li>)}</ul></div></section></Reveal>
        <section id="faqs" className="service-section mt-12"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] service-accent">04 / A few helpful answers</p><h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">Good to know</h2><div className="mt-5 divide-y divide-zinc-200 border-y border-zinc-200">{s.faqs.map(f => <details key={f.q} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">{f.q}<span className="text-xl font-normal text-zinc-400 transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 pr-8 text-xs leading-7 text-zinc-500">{f.a.replace(/UC-verified/g, "service-grade")}</p></details>)}<details className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">Where can I find my booking?<span className="text-xl font-normal text-zinc-400 transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 text-xs leading-7 text-zinc-500">Sign in and open <Link href="/bookings" className="underline">My bookings</Link> to see your confirmation, address, scheduled time and booking status.</p></details></div></section>
      </div>
      <aside id="booking" className="service-section order-first lg:order-last"><div className="lg:sticky lg:top-44"><div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_12px_45px_-28px_rgba(0,0,0,0.25)]"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Make it part of your day</p><Icon className="h-5 w-5 service-accent" /></div><div className="mt-4 flex items-baseline gap-2"><p className="text-3xl font-bold tracking-tight">{formatINR(s.price)}</p><span className="text-xs text-zinc-500">{unit}</span></div><p className="mt-2 text-[11px] leading-5 text-zinc-500">Final total and applicable fees are shown at checkout.</p><div className="my-5 border-t border-zinc-100" /><BuyBox slug={s.slug} price={s.price} /><div className="my-5 border-t border-zinc-100" /><div className="space-y-3 text-xs text-zinc-500"><p className="flex items-center gap-2"><Clock3 className="h-4 w-4 service-accent" />Approx. {s.durationMin} minutes</p><p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 service-accent" />Choose your preferred date and slot</p><p className="flex items-center gap-2"><ReceiptText className="h-4 w-4 service-accent" />Itemized booking summary</p></div></div><Link href={`/categories/${s.category}`} className="mt-4 flex items-center justify-between rounded-xl p-5 text-xs font-semibold service-surface service-accent">Explore {cat?.name || "similar services"}<ArrowUpRight className="h-4 w-4" /></Link></div></aside>
    </div>
    {related.length > 0 && <section className="mx-auto max-w-7xl px-5 py-12 sm:px-6"><div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] service-accent">Complete your routine</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">A little more care.</h2></div><Link href={`/categories/${s.category}`} className="flex items-center gap-2 text-xs font-semibold service-accent">See all <ArrowRight className="h-4 w-4" /></Link></div><div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">{related.map((r, i) => <ServiceCard key={r.slug} s={r} index={i} />)}</div></section>}
  </div>;
}

