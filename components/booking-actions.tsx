"use client";
import { sessionFetch } from "@/lib/session-client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/lib/types";
import { openPayment } from "@/lib/payment-client";
import { indiaDate } from "@/lib/booking-rules";
import { useQuote } from "@/lib/use-quote";

type VerificationState = "idle" | "checking" | "pending" | "confirmed";

export function BookingActions({ booking, stripeSessionId, paymentReturn }: { booking: Booking; stripeSessionId?: string; paymentReturn?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(booking.date);
  const [slot, setSlot] = useState(booking.slot);
  const [verification, setVerification] = useState<VerificationState>("idle");
  const attemptedSession = useRef("");
  const verificationInFlight = useRef(false);
  const { quote, loading: checking, error: quoteError } = useQuote(rescheduling ? booking.items.map(i => ({ slug: i.slug, qty: i.qty })) : [], date);
  const editable = ["pending", "confirmed"].includes(booking.status);
  const locked = busy || verification === "checking";
  const paymentResolved = ["paid", "refund_pending", "refunded"].includes(booking.paymentStatus || "");

  const verifyStripe = useCallback(async () => {
    if (!stripeSessionId || verificationInFlight.current) return;
    verificationInFlight.current = true;
    setVerification("checking"); setError(""); setMessage("");
    try {
      const response = await sessionFetch("/api/payments/stripe/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id, sessionId: stripeSessionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment confirmation is still pending. Check again before making another payment.");
      if (data.verified !== true || !["paid", "refund_pending", "refunded"].includes(data.paymentStatus)) {
        throw new Error("Payment confirmation is still pending. Check again before making another payment.");
      }
      setVerification("confirmed");
      setMessage(data.paymentStatus === "paid" ? "Your payment is confirmed." : data.paymentStatus === "refunded" ? "Your refund is confirmed to the original payment method." : "Payment was received after cancellation. Your refund is being processed automatically to the original payment method.");
      router.refresh();
    } catch (e) {
      setVerification("pending");
      setError(e instanceof Error ? e.message : "We could not confirm the payment yet. Please check again.");
    } finally { verificationInFlight.current = false; }
  }, [booking.id, stripeSessionId, router]);

  useEffect(() => {
    if (!stripeSessionId || paymentResolved || attemptedSession.current === stripeSessionId) return;
    const timer = window.setTimeout(() => {
      if (attemptedSession.current === stripeSessionId) return;
      attemptedSession.current = stripeSessionId;
      void verifyStripe();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stripeSessionId, paymentResolved, verifyStripe]);

  async function run(action: "pay" | "cancel" | "reschedule") {
    setBusy(true); setError(""); setMessage("");
    let redirected = false;
    try {
      if (action === "pay") {
        const result = await openPayment(booking);
        if (result.redirected) { redirected = true; return; }
        setMessage("Your payment is confirmed.");
      } else {
        const response = await sessionFetch(`/api/bookings/${encodeURIComponent(booking.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "reschedule" ? { action, date, slot } : { action }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The booking could not be updated. Please try again.");
        if (action === "cancel") {
          const updated = data.booking || data;
          setMessage(updated.refundStatus === "failed" ? "Booking cancelled. The payment provider could not complete the refund; support review is required." : updated.paymentStatus === "refunded" ? "Booking cancelled. Your refund is confirmed to the original payment method." : updated.paymentStatus === "refund_pending" ? "Booking cancelled. Your refund is being processed automatically to the original payment method." : "Your booking has been cancelled. The payment status below shows whether a refund is due.");
        }
      }
      setConfirm(false); setRescheduling(false);
      if (action === "reschedule") setMessage("Your visit has been rescheduled. Your price stays the same.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { if (!redirected) setBusy(false); }
  }

  return <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-5">
    {booking.status === "pending" && <p className="mb-4 text-sm leading-6 text-amber-800">Your booking is awaiting payment. Complete payment within 30 minutes of booking to confirm your visit.</p>}
    {paymentReturn === "cancelled" && !paymentResolved && <p className="mb-4 text-sm leading-6 text-zinc-600">You left payment checkout. Your booking is saved; its payment has not been confirmed.</p>}
    {paymentReturn === "pending" && !stripeSessionId && !paymentResolved && <p className="mb-4 text-sm leading-6 text-zinc-600">Your booking is saved. Payment could not be confirmed; check its status before trying again.</p>}
    {booking.paymentStatus === "refund_pending" && <div className="mb-4 flex gap-3 rounded-xl bg-amber-50 p-4 text-amber-900"><Undo2 className="mt-0.5 h-4 w-4 shrink-0" /><p className="text-sm leading-6">{booking.refundStatus === "failed" ? "The payment provider could not complete your refund. Support review is required; your refund has not been confirmed." : "Your refund is being processed automatically to the original payment method. It is not confirmed yet; the status will update when the payment provider confirms it."}{booking.refundId && <span className="mt-2 block break-all text-xs">Refund reference: {booking.refundId}</span>}</p></div>}
    {booking.paymentStatus === "refunded" && <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">Your refund is confirmed to the original payment method. The time it appears in your account depends on your bank or payment provider.</p>}
    {verification === "checking" && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-violet-700"><span aria-hidden="true" className="skeleton h-4 w-12" />Checking your payment confirmation…</p>}
    <div className="flex flex-wrap gap-3">
      {stripeSessionId && !paymentResolved && verification === "pending" && <Button onClick={() => void verifyStripe()} disabled={locked}><RefreshCw className="h-4 w-4" />Check payment status</Button>}
      {booking.status === "pending" && !paymentResolved && <Button onClick={() => run("pay")} disabled={locked}>Complete payment</Button>}
      {editable && <Button variant="outline" disabled={locked} onClick={() => { setRescheduling(v => !v); setConfirm(false); setError(""); }}><CalendarClock className="h-4 w-4" />Reschedule visit</Button>}
      {editable && <Button variant="outline" disabled={locked} onClick={() => confirm ? run("cancel") : setConfirm(true)}>{confirm ? "Confirm cancellation" : "Cancel booking"}</Button>}
      {confirm && <Button variant="ghost" disabled={locked} onClick={() => setConfirm(false)}>Keep booking</Button>}
    </div>
    {confirm && <p className="mt-3 text-xs leading-6 text-zinc-500">{booking.paymentStatus === "paid" ? "Cancelling this booking automatically requests a refund to your original payment method. Your refund stays pending until the payment provider confirms it." : "Cancelling releases your service slot. If a payment arrives afterward, a refund will be requested automatically."}</p>}
    {editable && rescheduling && <div className="mt-5 rounded-xl bg-zinc-50 p-4">
      <h3 className="font-semibold">Choose a new time</h3><p className="mt-1 text-xs text-zinc-500">Changes are available until 2 hours before your current confirmed visit.</p>
      <label htmlFor="reschedule-date" className="mb-2 mt-4 block text-sm font-medium">New date</label>
      <input id="reschedule-date" type="date" min={indiaDate()} max={indiaDate(30)} value={date} onChange={e => setDate(e.target.value)} className="max-w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{quote?.slots.map(s => <button key={s.slot} disabled={!s.available || locked} aria-pressed={slot === s.slot} onClick={() => setSlot(s.slot)} className={`rounded-lg border px-3 py-2.5 text-sm disabled:opacity-30 ${slot === s.slot ? "border-violet-600 bg-violet-50 text-violet-700" : "border-zinc-200 bg-white"}`}>{s.slot}</button>)}</div>
      {checking && <p role="status" className="mt-3 text-sm text-zinc-500">Checking available times…</p>}
      {quoteError && <p role="alert" className="mt-3 text-sm text-red-600">{quoteError}</p>}
      <Button className="mt-4" disabled={locked || checking || !quote?.slots.some(s => s.slot === slot && s.available)} onClick={() => run("reschedule")}>{busy && <span aria-hidden="true" className="skeleton h-4 w-12" />}Save new time</Button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm leading-6 text-zinc-700">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm leading-6 text-red-600">{error}</p>}
  </div>;
}
