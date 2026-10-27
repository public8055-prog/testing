"use client";
import { sessionFetch } from "@/lib/session-client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, BellRing, CalendarClock, Check, ChevronLeft, ChevronRight, CircleCheck, Copy, CreditCard, RefreshCw, Search, Send, TicketCheck, UserRound } from "lucide-react";
import type { TrackedService } from "@/lib/service-operations";
import { formatINR } from "@/lib/utils";
import { EmptyState, PageHeading } from "@/components/platform/shell";
import styles from "./workspace.module.css";
import { ServiceQueueBoard } from "./queue";
import { LocationLink } from "@/components/locations/location-link";
export type TrackingData = { services: TrackedService[]; total: number; page: number; pages: number; customers?: { id: string; name: string; email: string }[] };
const label = (value: string) => value.replaceAll("_", " ");
function dateTime(value: string) { return new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }); }
export function ServiceProgress({ status }: { status: string }) {
  const steps = ["Requested", "Confirmed", "In progress", "Completed"], index = ({ pending: 0, confirmed: 1, in_progress: 2, completed: 3 } as Record<string, number>)[status] ?? -1;
  if (index < 0) return <p className={styles.exceptionStatus}><Activity size={16}/>{label(status)} · Open the details or contact support.</p>;
  return <ol className={styles.progress} aria-label="Service progress">{steps.map((step, i) => <li key={step} data-state={i < index ? "done" : i === index ? "current" : "next"} aria-current={i === index ? "step" : undefined}><span>{i < index ? <Check size={13}/> : i + 1}</span><small>{step}</small></li>)}</ol>;
}
function FollowupEditor({ service, save, busy }: { service: TrackedService; save: (input: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [message, setMessage] = useState(""), [next, setNext] = useState(""), [notify, setNotify] = useState(true);
  return <form className={styles.followupForm} onSubmit={async e => { e.preventDefault(); if (await save({ action: "followup", token: service.tokenId, version: service.version, message, nextFollowupAt: next ? new Date(next).toISOString() : null, notify })) { setMessage(""); setNext(""); } }}>
    <label>Customer follow-up<textarea required minLength={5} maxLength={1500} rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a clear update, expected next step, or arrival information."/></label>
    <div className={styles.formRow}><label>Next follow-up (your local time)<input type="datetime-local" value={next} onChange={e => setNext(e.target.value)}/></label><label className={styles.checkbox}><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)}/> Send popup notification</label></div>
    <button className={styles.primary} disabled={busy} type="submit"><Send size={16}/> Send follow-up</button>
  </form>;
}
export function TrackingWorkspace({ initial, admin = false, initialToken = "",initialTokenId="" }: { initial: TrackingData; admin?: boolean; initialToken?: string;initialTokenId?:string }) {
  const [data, setData] = useState(initial), [query, setQuery] = useState(initialToken), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [expanded, setExpanded] = useState<string | null>(null), [copied, setCopied] = useState("");
  const endpoint = admin ? "/api/admin/operations" : "/api/service-tracking";
  const refresh = useCallback(async (page = 1, token = query) => {
    setLoading(true); setError("");
    try { const response = await sessionFetch(`${endpoint}?page=${page}&token=${encodeURIComponent(token.trim())}${!token&&initialTokenId?`&tokenId=${encodeURIComponent(initialTokenId)}`:""}`, { cache: "no-store" }); const value = await response.json(); if (!response.ok) throw new Error(value.error || "Unable to load services."); setData(value); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load services."); } finally { setLoading(false); }
  }, [endpoint, query,initialTokenId]);
  useEffect(() => { const update = () => { void refresh(data.page); }; window.addEventListener("urbankare:service-update", update); return () => window.removeEventListener("urbankare:service-update", update); }, [refresh, data.page]);
  async function save(input: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try { const response = await sessionFetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || "Unable to save this update."); setMessage("Service updated. The customer can see the latest information."); await refresh(data.page); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to save this update."); return false; } finally { setBusy(false); }
  }
  return <div className={styles.workspace}>
    {admin&&<ServiceQueueBoard/>}
    <PageHeading eyebrow={admin ? "Service operations" : "Every step, in view"} title={admin ? "Tokens & ongoing services" : "Your service timeline"} description={admin ? "Find a service token, record a follow-up, and keep the customer informed." : "Your service reference, live status, and follow-ups in one place."}/>
    <form className={styles.search} onSubmit={e => { e.preventDefault(); void refresh(1); }}><Search size={18}/><label className="sr-only" htmlFor="token-search">Service token</label><input id="token-search" value={query} maxLength={60} onChange={e => setQuery(e.target.value.toUpperCase())} placeholder="Search a token, e.g. TKN-20261025-0042"/><button className={styles.primary} disabled={loading}>Find token</button><button type="button" title="Refresh services" aria-label="Refresh services" className={styles.iconButton} disabled={loading} onClick={() => void refresh(data.page)}><RefreshCw size={18} className={loading ? styles.spin : ""}/></button></form>
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    {loading && <div className={styles.loading} role="status">Refreshing your service information…</div>}
    {!data.services.length ? <EmptyState title={query ? "No matching service token" : "Your next service starts here"} description={query ? "Check the reference. Only services you have permission to view are shown." : "When you book, your token and every service update will appear here."} href={admin ? "/admin/bookings" : "/services"} label={admin ? "View bookings" : "Find a service"}/> : <div className={styles.cards}>
      {data.services.map(service => <article className={styles.card} key={service.tokenId}>
        <div className={styles.cardTop}><span className={styles.token}><TicketCheck size={17}/>{service.token}</span><button className={styles.iconButton} aria-label={`Copy token ${service.token}`} onClick={async () => { try { await navigator.clipboard.writeText(service.token); setCopied(service.token); } catch { setError("Copy is unavailable. Select and copy the token text."); } }}>{copied === service.token ? <Check size={16}/> : <Copy size={16}/>}</button><span className={styles.status} data-status={service.status}>{label(service.status)}</span></div>
        <h2>{service.title}</h2><div className={styles.metadata}><span><CalendarClock size={15}/>{service.scheduledAt.includes("T") ? `${dateTime(service.scheduledAt)} IST` : service.scheduledAt}</span>{admin && <span><UserRound size={15}/>{service.customerName}</span>}<span><CreditCard size={15}/>{formatINR(service.total)} · {label(service.paymentStatus)}</span></div>
        <ServiceProgress status={service.status}/>
        {service.queue&&<div className={styles.latest}><TicketCheck size={18}/><div><small>Queue · {label(service.queue.status)}</small><p>{service.queue.status==="waiting"?`Position ${service.queue.position} · ${service.queue.tokensAhead} tokens ahead · Estimated wait ${service.queue.estimatedWaitMinutes} min`:service.queue.status==="called"?"Your token has been called. Please be ready for your professional.":label(service.queue.status)}</p><span>Currently serving: {service.queue.currentServing.join(", ")||"No customer called"}. Estimates can change.</span></div></div>}
        {service.followups.length > 0 ? <div className={styles.latest}><BellRing size={18}/><div><small>Latest follow-up · {dateTime(service.followups[0].createdAt)} IST</small><p>{service.followups[0].message}</p>{service.followups[0].nextFollowupAt && <span>Next follow-up: {dateTime(service.followups[0].nextFollowupAt)} IST</span>}</div></div> : <p className={styles.quiet}>Your confirmed booking details are available below. Follow-ups will appear here as they are recorded.</p>}
        <div className={styles.cardActions}><Link href={service.source === "catalog" ? admin ? "/admin" : `/bookings/${service.bookingId}` : admin ? "/admin/bookings" : `/dashboard/bookings/${service.bookingId}`} className={styles.secondary}>Booking details <ArrowRight size={15}/></Link><button className={styles.textButton} aria-expanded={expanded === service.tokenId} onClick={() => setExpanded(expanded === service.tokenId ? null : service.tokenId)}>{expanded === service.tokenId ? "Close timeline" : admin ? "Manage & follow up" : "View all updates"}</button></div>
        <LocationLink source={service.source} id={service.bookingId}/>
        {expanded === service.tokenId && <div className={styles.expanded}>
          {service.followups.length > 0 && <ol className={styles.history}>{service.followups.map(f => <li key={f.id}><CircleCheck size={16}/><div><time>{dateTime(f.createdAt)} IST</time><p>{f.message}</p>{f.nextFollowupAt && <small>Follow-up due {dateTime(f.nextFollowupAt)} IST</small>}</div></li>)}</ol>}
          {service.history.length > 0 && <details className={styles.historyDetails}><summary>Booking history</summary><ul>{service.history.map((event, i) => <li key={`${event.createdAt}-${i}`}><span>{label(event.status).replaceAll(".", " · ")}</span><time>{dateTime(event.createdAt)} IST</time></li>)}</ul></details>}
          {admin && <><div className={styles.statusActions}><p>Update service status</p>{(service.status === "pending" ? ["confirmed", "cancelled"] : service.status === "confirmed" ? ["in_progress", "cancelled"] : service.status === "in_progress" ? ["completed"] : []).map(status => <button className={status === "cancelled" ? styles.dangerButton : styles.secondary} disabled={busy} key={status} onClick={() => { if (status !== "cancelled" || window.confirm(`Cancel ${service.token}? The service will be cancelled and eligible paid catalogue bookings will enter the refund workflow.`)) void save({ action: "status", token: service.tokenId, status }); }}>{label(status)}</button>)}</div>
          <FollowupEditor service={service} busy={busy} save={save}/>
          {service.source === "catalog" && service.paymentStatus === "unpaid" && ["in_progress", "completed"].includes(service.status) && <form className={styles.receipt} onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const reference = String(new FormData(form).get("reference") || ""); if (window.confirm(`Confirm that ${formatINR(service.total)} in cash was actually received for ${service.token}? This creates an audited receipt.`)) if (await save({ action: "cash", token: service.tokenId, amount: service.total, receiptReference: reference })) form.reset(); }}><h3>Record cash received</h3><p>Use only after the full amount has actually been collected.</p><label>Receipt reference<input name="reference" minLength={5} maxLength={80} required placeholder="Receipt or collection reference"/></label><button className={styles.secondary} disabled={busy}>Confirm {formatINR(service.total)} received</button></form>}</>}
        </div>}
      </article>)}
    </div>}
    {data.pages > 1 && <nav className={styles.pagination} aria-label="Service pages"><button className={styles.secondary} disabled={loading || data.page <= 1} onClick={() => void refresh(data.page - 1)}><ChevronLeft size={16}/> Previous</button><span>{data.page} of {data.pages}</span><button className={styles.secondary} disabled={loading || data.page >= data.pages} onClick={() => void refresh(data.page + 1)}>Next <ChevronRight size={16}/></button></nav>}
  </div>;
}
