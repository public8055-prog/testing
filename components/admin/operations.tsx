"use client";
import { sessionFetch } from "@/lib/session-client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck, Wallet } from "lucide-react";
import type { Booking } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { ServiceQueueBoard } from "@/components/operations/queue";

type Dashboard = { bookings: Booking[]; metrics: { total: number; active: number; collected: number; refunds: number } };
const labels: Record<string, string> = { pending: "Awaiting payment", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const colors: Record<string, string> = { pending: "bg-amber-50 text-amber-700", confirmed: "bg-violet-50 text-violet-700", in_progress: "bg-blue-50 text-blue-700", completed: "bg-emerald-50 text-emerald-700", cancelled: "bg-zinc-100 text-zinc-500" };

export function AdminOperations({ name }: { name: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const refresh = useCallback(async () => {
    const response = await sessionFetch("/api/admin/bookings", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load appointments.");
    setData(body);
  }, []);
  useEffect(() => {
    let active = true;
    sessionFetch("/api/admin/bookings", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load appointments.");
      if (active) setData(body);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function update(id: string, status: string) {
    setBusy(id); setError("");
    try {
      const response = await sessionFetch(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Update failed.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    finally { setBusy(""); }
  }
  const shown = (data?.bookings || []).filter((b) => (filter === "all" || b.status === filter || (filter === "refunds" && b.paymentStatus === "refund_pending")) && `${b.name} ${b.id} ${b.phone} ${b.items.map((i) => i.title).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-violet-600"><ShieldCheck size={15} /> Operations workspace</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Every appointment, in view.</h1><p className="mt-3 text-sm text-zinc-500">Welcome, {name}. Manage service delivery and payment follow-ups.</p></div>
        <button onClick={() => { setError(""); refresh().catch((e) => setError(e.message)); }} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-zinc-50"><RefreshCw size={15} /> Refresh</button>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total bookings", value: data?.metrics.total, icon: CheckCircle2, detail: "Across all appointments" },
          { label: "Active appointments", value: data?.metrics.active, icon: Clock3, detail: "Pending, confirmed and in progress" },
          { label: "Collected payments", value: data ? formatINR(Number(data.metrics.collected)) : undefined, icon: Wallet, detail: "Captured online + collected cash" },
          { label: "Open refunds", value: data?.metrics.refunds, icon: ArrowUpRight, detail: "Pending or needing review" },
        ].map((metric) => <div key={metric.label} className="rounded-2xl border border-zinc-200 bg-white p-6"><div className="flex items-center justify-between text-sm text-zinc-500">{metric.label}<metric.icon size={17} className="text-violet-500" /></div><div className="mt-4 text-3xl font-semibold tracking-tight">{metric.value ?? "—"}</div><p className="mt-2 text-xs text-zinc-400">{metric.detail}</p></div>)}
      </div>
      {error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {Number(data?.metrics.refunds) > 0 && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Eligible cancellations request refunds automatically. The worker retries temporary failures. Refunds marked as needing review require investigation using the original provider reference.</p>}
      <div className="mt-8"><ServiceQueueBoard/></div>
      <section className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 p-5"><div><h2 className="text-lg font-semibold">Appointments</h2><p className="mt-1 text-xs text-zinc-400">Latest 100 bookings · {shown.length} shown</p></div><label className="relative block"><Search className="absolute left-3 top-3 text-zinc-400" size={16} /><input aria-label="Search appointments" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or service" className="h-10 w-64 rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none focus:border-violet-500" /></label></div>
        <div className="flex gap-2 overflow-x-auto border-b border-zinc-100 px-5 py-4">{["all", "confirmed", "in_progress", "pending", "completed", "cancelled", "refunds"].map((key) => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${filter === key ? "bg-zinc-950 text-white" : "text-zinc-500 hover:bg-zinc-100"}`}>{key === "all" ? "All bookings" : key === "refunds" ? "Refunds processing" : labels[key]}</button>)}</div>
        {!data ? <p className="p-12 text-center text-sm text-zinc-500">Loading appointments…</p> : !shown.length ? <div className="p-16 text-center"><CheckCircle2 className="mx-auto text-zinc-300" size={36} /><h3 className="mt-4 font-semibold">No appointments here yet</h3><p className="mt-2 text-sm text-zinc-500">New bookings will appear here automatically when you refresh.</p></div> : (
          <div className="divide-y divide-zinc-100">{shown.map((booking) => <article key={booking.id} className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:items-center">
            <div><p className="font-semibold">{booking.items.map((i) => `${i.title}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ")}</p><p className="mt-2 text-sm text-zinc-500">{booking.name} · {booking.phone}</p><p className="mt-1 text-xs leading-relaxed text-zinc-400">{booking.address}</p><p className="mt-2 font-mono text-[10px] text-zinc-400">{booking.id}</p></div>
            <div><p className="text-sm font-medium">{booking.date}</p><p className="mt-1 text-sm text-zinc-500">{booking.slot}</p><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${colors[booking.status]}`}>{labels[booking.status]}</span></div>
            <div><p className="font-semibold">{formatINR(booking.total)}</p><p className="mt-1 text-xs text-zinc-500">{booking.payment === "cash" ? "Cash" : booking.paymentProvider === "stripe" ? "Stripe" : booking.paymentProvider === "razorpay" ? "Razorpay" : "Online payment"}</p><p className={`mt-2 text-xs font-medium ${booking.paymentStatus === "refund_pending" ? "text-amber-700" : booking.paymentStatus === "paid" ? "text-emerald-600" : "text-zinc-500"}`}>{booking.refundStatus === "failed" ? "Refund needs review" : booking.paymentStatus === "paid" ? "Payment received" : booking.paymentStatus === "refund_pending" ? "Refund processing" : booking.paymentStatus === "refunded" ? "Refund confirmed" : "Not collected"}</p>{booking.refundId && <p className="mt-1 break-all text-xs text-zinc-500">{booking.refundId}</p>}</div>
            <div className="flex flex-wrap gap-2 lg:justify-end">{booking.status === "confirmed" && <button disabled={Boolean(busy)} onClick={() => update(booking.id, "in_progress")} className="rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">Start service</button>}{booking.status === "in_progress" && <button disabled={Boolean(busy)} onClick={() => update(booking.id, "completed")} className="rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{booking.payment === "cash" ? "Cash received · Complete" : "Complete service"}</button>}{["pending", "confirmed"].includes(booking.status) && <button disabled={Boolean(busy)} onClick={() => update(booking.id, "cancelled")} className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">Cancel booking</button>}</div>
          </article>)}</div>
        )}
      </section><Link href="/" className="mt-6 inline-block text-sm text-zinc-500 hover:text-zinc-950">← Back to storefront</Link>
    </div>
  );
}

