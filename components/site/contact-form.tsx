"use client";
import Link from "next/link";
import { useState } from "react";
import {useAccountSession} from "./session-provider";
export function ContactForm() {
  const {catalogOnly}=useAccountSession();
  const [error, setError] = useState(""), [reference, setReference] = useState(""), [pending, setPending] = useState(false);
  if(catalogOnly)return <section className="rounded-2xl border border-teal-200 bg-teal-50 p-6"><h2 className="text-xl font-semibold">Contact options</h2><p className="mt-3 text-sm leading-7">The online support form is not open yet. Use the available contact options on this page. Please do not send payment details or identity documents.</p></section>;
  return <form className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6" onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setError(""); setPending(true);
    try { const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), email: data.get("email"), subject: data.get("subject"), message: data.get("message"), consent: data.get("consent") === "on", website: data.get("website") }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Your request could not be saved."); setReference(result.reference); form.reset(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to send. Please try again."); } finally { setPending(false); }
  }}>
    <h2 className="text-xl font-semibold">Send a support request</h2>
    <p className="text-sm leading-6 text-slate-600">Use this form for service, refund, privacy or accessibility questions. Do not include passwords, card details or identity documents.</p>
    {[["name", "Your name", "text", 80], ["email", "Reply email", "email", 254], ["subject", "Subject", "text", 120]].map(([name, label, type, max]) => <label className="grid gap-2 text-sm font-medium" key={name}><span>{label}</span><input className="min-h-12 rounded-lg border border-slate-300 px-3 font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700" name={String(name)} type={String(type)} maxLength={Number(max)} required autoComplete={name === "name" ? "name" : name === "email" ? "email" : "off"}/></label>)}
    <label className="grid gap-2 text-sm font-medium">How can we help?<textarea className="rounded-lg border border-slate-300 p-3 font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700" name="message" minLength={15} maxLength={3000} rows={5} required/></label>
    <div hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <label className="flex min-h-12 items-start gap-3 text-sm leading-6 text-slate-700"><input className="mt-1 h-5 w-5 shrink-0 accent-teal-700" type="checkbox" name="consent" required/><span>I consent to using these details to handle my request, as described in the <Link href="/privacy" className="font-semibold text-teal-800 underline">Privacy notice</Link>.</span></label>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {reference && <p role="status" className="rounded-lg bg-teal-50 p-4 text-sm leading-6 text-teal-900">Your request was saved for the support team. Reference: <strong>{reference}</strong>. Keep this reference when following up. This confirmation is not an email-delivery receipt.</p>}
    <button className="uk-button justify-center disabled:opacity-50" disabled={pending}>{pending ? "Sending request…" : "Send support request"}</button>
  </form>;
}
