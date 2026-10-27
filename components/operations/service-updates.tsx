"use client";
import { sessionFetch } from "@/lib/session-client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ArrowRight, BellRing, X } from "lucide-react";
import { useAccountSession } from "@/components/site/session-provider";
import type { ServiceUpdate, TrackedService } from "@/lib/service-operations";
import styles from "./updates.module.css";
import { subscribeToUpdates } from "@/lib/live-client";

export function ServiceUpdates() {
  const { user } = useAccountSession();
  return user ? <AuthenticatedServiceUpdates key={user.id} userId={user.id}/> : null;
}
function AuthenticatedServiceUpdates({ userId }: { userId: string }) {
  const pathname = usePathname(), router = useRouter();
  const [popup, setPopup] = useState<ServiceUpdate | null>(null), [active, setActive] = useState<TrackedService | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const currentPopup = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false, pending = false, queued = false, lastFetched = 0;
    let controller: AbortController | undefined;
    const seen = new Set<string>();
    const refresh = async () => {
      if (disposed || !navigator.onLine || document.visibilityState !== "visible") return;
      if (pending) { queued = true; return; }
      pending = true; lastFetched = Date.now();
      const request = new AbortController(); controller = request;
      try {
        const [inbox, tracking] = await Promise.all([sessionFetch("/api/notifications", { signal: request.signal, cache: "no-store" }), sessionFetch("/api/service-tracking?active=1", { signal: request.signal, cache: "no-store" })]);
        const [inboxData, trackingData] = await Promise.all([
          inbox.ok ? inbox.json() as Promise<{ notifications: ServiceUpdate[]; unread: number }> : null,
          tracking.ok ? tracking.json() as Promise<{ services: TrackedService[] }> : null,
        ]);
        if (disposed || request.signal.aborted || !navigator.onLine) return;
        if (inboxData) {
          window.dispatchEvent(new CustomEvent("urbankare:unread", { detail: inboxData.unread }));
          const next = inboxData.notifications.find(n => !n.read_at && !n.popup_dismissed_at && !seen.has(n.id));
          if (next && !currentPopup.current) { seen.add(next.id); currentPopup.current = next.id; setPopup(next); }
        }
        if (trackingData) setActive(trackingData.services.find(s => s.status === "in_progress") || trackingData.services[0] || null);
      } catch { /* Online, stream-ready and focus events retry the durable inbox. */ }
      finally {
        if (controller === request) controller = undefined;
        pending = false;
        if (queued && !disposed) { queued = false; void refresh(); }
      }
    };
    const synchronize = () => { void refresh(); window.dispatchEvent(new Event("urbankare:service-update")); };
    const disconnect=subscribeToUpdates({onReady:synchronize,onUpdate:synchronize});
    const visibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const focus = () => { if(Date.now()-lastFetched>1500)void refresh(); };
    const offline = () => { queued = false; controller?.abort(); };
    const online = () => { synchronize(); };
    const changed = () => { void refresh(); };
    void refresh(); document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", focus); window.addEventListener("offline", offline); window.addEventListener("online", online); window.addEventListener("urbankare:inbox-change", changed);
    return () => { disposed = true; queued = false; controller?.abort(); disconnect(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", focus); window.removeEventListener("offline", offline); window.removeEventListener("online", online); window.removeEventListener("urbankare:inbox-change", changed); };
  }, [userId]); // Each authenticated identity gets one stream, shared across route changes.
  useEffect(() => { window.dispatchEvent(new Event("urbankare:inbox-change")); }, [pathname]);
  const canShow = Boolean(popup && !pathname.startsWith("/admin") && !pathname.startsWith("/checkout") && !pathname.startsWith("/login"));
  useEffect(() => { if (canShow && modal.current && !modal.current.open) modal.current.showModal(); else if (!canShow) modal.current?.close(); }, [canShow, popup]);
  async function dismiss(read = false) {
    const current = popup; currentPopup.current = null; setPopup(null); modal.current?.close(); if (!current) return;
    try { await sessionFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: current.id, action: read ? "read" : "dismiss" }) }); window.dispatchEvent(new Event("urbankare:inbox-change")); } catch { /* Still retained as unread on the server. */ }
  }
  const showOngoing = active && !pathname.startsWith("/admin") && !pathname.startsWith("/dashboard/tracking") && !pathname.startsWith("/checkout") && !pathname.startsWith("/login");
  return <>
    {showOngoing && <div className={styles.ongoingSpacer} aria-hidden="true"/>}
    {showOngoing && <Link href={`/dashboard/tracking?tokenId=${encodeURIComponent(active.tokenId)}`} className={styles.ongoing}><span className="sr-only">Track your service: </span><span className={styles.activity}><Activity size={20} aria-hidden="true"/></span><span><small>{active.status === "in_progress" ? "Your service is in progress" : "Your next service"}</small><strong>{active.title}</strong></span><ArrowRight size={17} aria-hidden="true"/></Link>}
    <dialog className={styles.popup} ref={modal} aria-labelledby="service-update-title" aria-describedby="service-update-message" onCancel={e => { e.preventDefault(); void dismiss(); }}>
      {popup && <><button className={styles.close} aria-label="Dismiss service update" onClick={() => void dismiss()}><X size={21}/></button><span className={styles.bell}><BellRing size={28}/></span><p className={styles.eyebrow}>A SERVICE UPDATE FOR YOU</p><h2 id="service-update-title">{popup.title}</h2>{popup.token && <span className={styles.token}>{popup.token}</span>}<p id="service-update-message">{popup.message}</p><div className={styles.actions}><button onClick={() => { const href = popup.href; void dismiss(true); router.push(href); }}>View service <ArrowRight size={17}/></button><button onClick={() => void dismiss()}>Read later</button></div><small>Saved to your updates inbox.</small></>}
    </dialog>
  </>;
}
