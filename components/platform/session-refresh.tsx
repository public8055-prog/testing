"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { refreshSession } from "@/lib/session-client";
export function SessionRefresh({ next }: { next: string }) {
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void refreshSession().then(session => { if (active) window.location.replace(session.user ? next : `/login?next=${encodeURIComponent(next)}`); }).catch(() => { if (active) setError("We could not restore your session. Please sign in again."); }); return () => { active = false; }; }, [next]);
  return <div className="mx-auto max-w-lg px-5 py-16">{error ? <div role="alert"><p>{error}</p><Link className="uk-button mt-6" href={`/login?next=${encodeURIComponent(next)}`}>Sign in again</Link></div> : <div role="status" aria-label="Restoring your session"><div className="skeleton h-8 w-3/4"/><div className="skeleton mt-5 h-28 w-full"/><p className="mt-6 text-sm">Restoring your session…</p></div>}</div>;
}
