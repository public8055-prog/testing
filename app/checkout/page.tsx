"use client";
import {useAccountSession} from "@/components/site/session-provider";
import {AccountsUnavailable} from "@/components/site/accounts-unavailable";
import { refreshSession, sessionFetch } from "@/lib/session-client";
import { ResilientImage } from "@/components/ui/resilient-image";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Clock, Wallet, ChevronRight, ShieldCheck, ArrowLeft } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { useQuote } from "@/lib/use-quote";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Input, Textarea, Separator } from "@/components/ui/primitives";
import { indiaDate, SLOTS } from "@/lib/booking-rules";
import { openPayment, type PaymentConfiguration } from "@/lib/payment-client";

const dates = Array.from({length:7},(_,i)=>indiaDate(i));

const slots = SLOTS;

export default function CheckoutPage() {
  const { lines, clear } = useCart();
  const {catalogOnly}=useAccountSession();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", address: "", date: indiaDate(1), slot: "11:00 AM", payment: "cash" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signedIn,setSignedIn]=useState<boolean|null>(null);
  const [paymentConfig,setPaymentConfig]=useState<PaymentConfiguration|null>(null);
  const online = Boolean(paymentConfig?.enabled);
  const methodAvailable = (method: string) => method === "cash" || Boolean(paymentConfig?.methods[method as "upi" | "card"]);
  const {quote,loading:quoteLoading,error:quoteError}=useQuote(lines,form.date);
  const availability=quote?.slots||[];
  const idempotency=useRef("");
  useEffect(()=>{if(catalogOnly)return;fetch("/api/auth/me").then(r=>r.json()).then(async d=>{const session=d.requiresRefresh?await refreshSession():d;setSignedIn(!!session.user);if(session.user)setForm(f=>({...f,name:f.name||session.user.name}));}).catch(()=>setSignedIn(false));fetch("/api/payments/config").then(async r=>{if(!r.ok)throw new Error("Payment settings unavailable");return r.json();}).then(d=>setPaymentConfig(d)).catch(()=>setPaymentConfig(null));},[catalogOnly]);

  const detailed = quote?.items||[];
  const {subtotal=0,discount=0,visitFee=0,total=0}=quote||{};
  const slotAvailable=availability.some(s=>s.slot===form.slot&&s.available);

  const set = (k: string, v: string) => {idempotency.current="";setForm((f) => ({ ...f, [k]: v }));};

  async function placeOrder() {
    setError("");
    if(!signedIn){router.push("/login?next=/checkout");return;}
    if (!form.name.trim() || form.name.length < 2) return setError("Please enter your full name.");
    if (!/^[6-9][0-9]{9}$/.test(form.phone.replace(/\s/g, ""))) return setError("Enter a valid 10-digit Indian mobile number.");
    if (form.address.trim().length < 12||!(/\b[1-9]\d{5}\b/).test(form.address)) return setError("Please enter a complete address with a 6-digit pincode.");
    if(!quote||!slotAvailable)return setError("Please choose an available time for your services.");
    if (detailed.length === 0) return setError("Your cart is empty.");
    if (!methodAvailable(form.payment)) return setError("This payment method is currently unavailable. Please choose another option.");
    setLoading(true);
    let bookingId="";
    let redirected=false;
    try {
      if(!idempotency.current)idempotency.current=crypto.randomUUID();
      const res = await sessionFetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key":idempotency.current },
        body: JSON.stringify({
          items: detailed.map((d) => ({ slug: d.slug, qty: d.qty })),
          ...form,
          expectedTotal:total,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Checkout failed");
      bookingId=json.booking.id;
      clear();
      if(form.payment!=="cash") {
        const result=await openPayment(json.booking);
        if(result.redirected){redirected=true;return;}
      }
      router.push(`/bookings/${json.booking.id}?success=1`);
    } catch (e: unknown) {
      if(bookingId){router.push(`/bookings/${bookingId}?payment=pending`);return;}
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if(!redirected)setLoading(false);
    }
  }

  if(catalogOnly)return <AccountsUnavailable/>;
  return (
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-6 sm:py-12">
      <Link href="/cart" className="inline-flex items-center gap-1 text-sm font-bold text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> Back to cart
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Checkout</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
        <ShieldCheck className="h-4 w-4 text-violet-700" /> Choose your time, add your details and confirm your booking
      </p>

      {/* steps */}
      <div className="mt-5 flex items-center gap-2 text-xs font-bold">
        {["Cart", "Details", "Confirmed"].map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span className={`grid h-6 w-6 place-items-center rounded-full ${i <= 1 ? "bg-violet-600 text-white" : "bg-zinc-200 text-zinc-500"}`}>{i + 1}</span>
            <span className={i <= 1 ? "text-zinc-900" : "text-zinc-400"}>{s}</span>
            {i < 2 && <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />}
          </span>
        ))}
      </div>

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-5 w-5 text-violet-600" /> Slot — {form.date} · {form.slot}</h2>
            <p className="mt-3 text-xs font-bold uppercase tracking-wider text-zinc-400">Date</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {dates.map((d) => (
                <button key={d} aria-pressed={form.date === d} onClick={() => set("date", d)} className={`shrink-0 rounded-xl border px-4 py-2.5 text-sm font-bold transition cursor-pointer ${form.date === d ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:border-zinc-300"}`}>
                  {new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short",timeZone:"Asia/Kolkata"})}
                </button>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400"><Clock className="h-3.5 w-3.5" /> Time slot</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {slots.map((t) => (
                <button key={t} aria-pressed={form.slot === t} disabled={!availability.some(s=>s.slot===t&&s.available)} onClick={() => set("slot", t)} className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${form.slot === t ? "border-violet-600 bg-violet-50 text-violet-700" : "border-zinc-200 hover:border-zinc-300"}`}>
                  {t}
                </button>
              ))}
            </div>
            {quote&&<p className="mt-3 text-xs leading-5 text-zinc-500">Estimated service time: {quote.durationMin} minutes. Slots allow enough time to finish by 9 PM.</p>}
            {quoteLoading&&<p role="status" className="mt-3 text-xs text-zinc-500">Checking current prices and available times…</p>}
            {quote&&!slotAvailable&&<p className="mt-3 text-xs text-amber-700">Choose an available slot above to continue.</p>}
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold">Contact & address</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-name" className="mb-1.5 block text-xs font-medium text-zinc-500">Full name</label>
                <Input id="checkout-name" name="name" autoComplete="name" maxLength={80} placeholder="Aarav Mehta" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label htmlFor="checkout-phone" className="mb-1.5 block text-xs font-medium text-zinc-500">Phone number</label>
                <Input id="checkout-phone" name="phone" type="tel" autoComplete="tel-national" maxLength={15} placeholder="98765 43210" inputMode="numeric" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="checkout-address" className="mb-1.5 block text-xs font-medium text-zinc-500">Full address</label>
              <Textarea id="checkout-address" name="address" autoComplete="street-address" maxLength={500} placeholder="Flat, street, landmark, pincode…" value={form.address} onChange={(e) => set("address", e.target.value)} />
              <p className="mt-2 text-xs leading-5 text-zinc-500">After booking, open Address &amp; live location to confirm a map pin and share GPS with your assigned professional when needed.</p>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold"><Wallet className="h-5 w-5 text-violet-600" /> Payment</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { id: "upi", t: "UPI", s: "GPay / PhonePe" },
                { id: "card", t: "Card", s: "Credit / Debit" },
                { id: "cash", t: "Cash", s: "After service" },
              ].map((p) => (
                <button key={p.id} aria-pressed={form.payment === p.id} disabled={!methodAvailable(p.id)} onClick={() => set("payment", p.id)} className={`rounded-2xl border p-4 text-left transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${form.payment === p.id ? "border-violet-600 bg-violet-50 ring-2 ring-violet-600/15" : "border-zinc-200 hover:border-zinc-300"}`}>
                  <p className="font-semibold">{p.t}</p>
                  <p className="text-xs text-zinc-500">{methodAvailable(p.id) ? p.s : "Currently unavailable"}</p>
                </button>
              ))}
            </div>
            {!online&&<p className="mt-3 text-xs text-zinc-500">Online payment is currently unavailable. You can book now and pay after your service.</p>}
            {online&&form.payment!=="cash"&&<p className="mt-3 text-xs leading-5 text-zinc-500">We will open the available secure checkout for your selected payment method. Your booking stays saved if you leave checkout.</p>}
          </Card>
        </div>

        <aside className="mt-6 lg:mt-0">
          <Card className="p-6 lg:sticky lg:top-32">
            <h2 className="font-semibold">Order summary</h2>
            <div className="mt-3 max-h-56 space-y-2.5 overflow-y-auto">
              {lines.length === 0 && <p className="text-sm text-zinc-500">No items. <Link href="/#categories" className="font-bold text-violet-700">Add services</Link></p>}
              {quoteLoading&&<p role="status" className="text-sm text-zinc-500">Updating your order summary…</p>}
              {detailed.map((d) => (
                <div key={d.slug} className="flex items-center gap-3">
                  <ResilientImage src={d.s.image} sizes="44px" alt={d.s.title} className="h-11 w-11 rounded-lg object-cover" />
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{d.s.title} × {d.qty}</p>
                  <p className="text-[13px] font-semibold">{formatINR(d.s.price * d.qty)}</p>
                </div>
              ))}
            </div>
            <Separator className="my-4" />
            <div className="space-y-1.5 text-sm">
              <p className="flex justify-between"><span className="text-zinc-500">Subtotal</span><b>{formatINR(subtotal)}</b></p>
              <p className="flex justify-between text-violet-700"><span>Checkout discount</span><b>− {formatINR(discount)}</b></p>
              <p className="flex justify-between"><span className="text-zinc-500">Visit fee</span><b>{visitFee === 0 ? "FREE" : formatINR(visitFee)}</b></p>
            </div>
            <Separator className="my-4" />
            <p className="flex justify-between text-lg font-bold"><span>Total</span><span>{formatINR(total)}</span></p>
            {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] font-semibold text-red-600">{error}</p>}
            {quoteError&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{quoteError} <Link className="underline" href="/cart">Edit cart</Link></p>}
            <Button variant="default" size="lg" className="mt-4 w-full rounded-lg text-sm shadow-none" onClick={placeOrder} disabled={loading || quoteLoading || signedIn===null || !quote || !slotAvailable}>
              {loading ? <><span aria-hidden="true" className="skeleton h-4 w-12" /> Processing…</> : signedIn===false?"Sign in to book":`Confirm · ${formatINR(total)}`}
            </Button>
            <p className="mt-2 text-center text-xs text-zinc-400">{form.payment==="cash"?"No payment required now.":"Continue to secure payment after confirming."}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}


