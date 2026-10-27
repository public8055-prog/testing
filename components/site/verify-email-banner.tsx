"use client";
import Link from "next/link";
import { useAccountSession } from "./session-provider";
import { AlertTriangle, Mail, ArrowRight, Loader2 } from "lucide-react";

export function VerifyEmailBanner() {
  const { user, loading } = useAccountSession();
  if (loading || !user) return null;
  if (Number(user.email_verified) === 1) return null;
  return (
    <div className="sticky top-0 z-[60] border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm">
      <div className="uk-shell max-w-none flex items-center gap-3">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-amber-100 text-amber-800"><AlertTriangle size={16} /></div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-900">Verify your email address</p>
          <p className="text-amber-700">We sent a 6-digit code to <strong>{user.email}</strong>. Enter it to confirm your account and unlock booking.</p>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <button type="button" className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Enter code</button>
          <Link href="/login/reset" className="rounded-xl border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">Use reset link</Link>
        </div>
      </div>
    </div>
  );
}

export function EmailVerificationRequired() {
  const { user, loading } = useAccountSession();
  if (loading || !user) return null;
  if (Number(user.email_verified) === 1) return null;
  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center">
      <div className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-800 mb-4"><Mail size={15} /> Verify your email</div>
      <h2 className="text-2xl font-semibold tracking-tight text-[#142b3b] mb-2">Confirm your email to continue</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500 max-w-md mx-auto">A 6-digit code was sent to <strong>{user.email}</strong>. Enter it to verify your address and unlock booking and account features.</p>
      <p className="mt-6 text-xs text-slate-400">Did not receive it? <button type="button" className="font-medium text-amber-700 underline underline-offset-2">Request a new code</button></p>
    </div>
  );
}
