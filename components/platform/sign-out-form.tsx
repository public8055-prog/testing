"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function SignOutForm() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <form action="/api/auth/logout" method="post" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new CustomEvent("urbankare:session", { detail: { user: null } }));
      window.location.replace("/login");
    } catch { setError("Unable to sign out. Please try again."); setBusy(false); }
  }}>
    <button type="submit" disabled={busy} className="mt-3 flex min-h-11 items-center gap-2 text-sm text-slate-600 disabled:opacity-50"><LogOut size={16} aria-hidden="true"/>{busy ? "Signing out…" : "Sign out"}</button>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </form>;
}
