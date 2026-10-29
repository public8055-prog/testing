"use client";
import { useState } from "react";
import Link from "next/link";
import { useHydrated } from "@/hooks/use-hydrated";
import { isAdminRole, canonicalRole } from "@/lib/roles";

export function EmailVerificationForm({ email, configured }: { email: string; configured: boolean }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function requestCode() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, purpose: "verify" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to send a code. Please retry.");
      setNotice("If this account is eligible, a new code will arrive by email. Check your inbox and spam folder.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to send a code. Please retry."); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
    <h1 className="text-2xl font-semibold">Verify your email</h1>
    <p className="mt-3 break-words text-sm leading-6 text-slate-600">Confirm <strong className="break-all">{email}</strong> with a six-digit email code before making a booking.</p>
    {!configured ? <p className="mt-5 text-sm leading-6">Email verification is temporarily unavailable. Your account is saved. <Link href="/contact" className="underline underline-offset-4">Contact support</Link> for help.</p> : <>
      <form method="post" className="mt-6 space-y-4" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(""); setNotice("");
        const code = new FormData(event.currentTarget).get("code");
        try {
          const response = await fetch("/api/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, purpose: "verify" }) });
          const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to verify this code. Please retry.");
          const destination = isAdminRole(body.user.role) ? "/admin/dashboard" : canonicalRole(body.user.role) === "PROVIDER" ? "/provider/dashboard" : "/dashboard";
          window.location.replace(destination);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify this code. Please retry."); setBusy(false); }
      }}>
        <label className="block text-sm font-medium">Six-digit code<input name="code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4"/></label>
        <button type="submit" disabled={busy||!hydrated} className="min-h-11 w-full rounded-xl bg-teal-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Please wait…" : "Verify email"}</button>
      </form>
      <button type="button" disabled={busy||!hydrated} onClick={requestCode} className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">Send a new verification code</button>
    </>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm leading-6 text-teal-900">{notice}</p>}
    <Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to your dashboard</Link>
  </section>;
}
