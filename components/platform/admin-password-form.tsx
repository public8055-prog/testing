"use client";
import { useState, type FormEvent } from "react";
import { sessionFetch } from "@/lib/session-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { PasswordField } from "./password-field";

export function AdminPasswordForm() {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) { setError("The new passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await sessionFetch("/api/admin/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change password. Please try again.");
      window.location.replace("/login");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to change password. Please try again."); setBusy(false); }
  }
  return <form method="post" onSubmit={submit} className="max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
    <h2 className="text-lg font-semibold">Change your password</h2>
    <p className="text-sm text-slate-600 dark:text-slate-300">Choose at least 10 characters. All devices will be signed out after the change.</p>
    <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" required maxLength={128}/>
    <PasswordField label="New password" name="newPassword" autoComplete="new-password" required minLength={10} maxLength={128}/>
    <PasswordField label="Confirm new password" name="confirmPassword" autoComplete="new-password" required minLength={10} maxLength={128}/>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <button disabled={busy || !hydrated} className="min-h-11 rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Updating password…" : "Change password and sign out"}</button>
  </form>;
}
