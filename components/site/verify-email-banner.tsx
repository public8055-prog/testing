"use client";
import Link from "next/link";
import { useAccountSession } from "./session-provider";
import { AlertTriangle, Mail } from "lucide-react";
import { isAdminRole } from "@/lib/roles";

export function VerifyEmailBanner() {
  const { user, loading } = useAccountSession();
  if (loading || !user) return null;
  if (Number(user.email_verified) !== 0 || isAdminRole(user.role)) return null;
  return (
    <div aria-label="Email verification" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm">
      <div className="uk-shell flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-amber-100 text-amber-800"><AlertTriangle size={16} /></div>
        <div className="w-full min-w-0 flex-1">
          <p className="font-semibold text-amber-900">Verify your email address</p>
          <p className="break-words text-amber-950">Confirm <strong className="break-all">{user.email}</strong> before making a booking.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/dashboard/verify" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-950">Verify email</Link>
        </div>
      </div>
    </div>
  );
}

export function EmailVerificationRequired() {
  const { user, loading } = useAccountSession();
  if (loading || !user) return null;
  if (Number(user.email_verified) !== 0 || isAdminRole(user.role)) return null;
  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center">
      <div className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-800 mb-4"><Mail size={15} /> Verify your email</div>
      <h2 className="text-2xl font-semibold tracking-tight text-[#142b3b] mb-2">Confirm your email to continue</h2>
      <p className="mx-auto mt-2 max-w-md break-words text-sm leading-6 text-slate-600">Confirm <strong className="break-all">{user.email}</strong> to enable booking.</p>
      <Link href="/dashboard/verify" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-teal-900 px-5 py-3 font-semibold text-white">Verify email</Link>
    </div>
  );
}
