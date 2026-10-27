import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, MapPin, Phone, CalendarDays, Wallet, ArrowRight } from "lucide-react";
import { getBooking } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { BookingActions } from "@/components/booking-actions";
import { formatINR } from "@/lib/utils";
import { Card, Badge, Separator } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { LocationLink } from "@/components/locations/location-link";

export const dynamic = "force-dynamic";

export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; stripe_session_id?: string; payment?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const stripeSessionId = typeof sp.stripe_session_id === "string" && sp.stripe_session_id.length < 512 ? sp.stripe_session_id : undefined;
  const returnParams = new URLSearchParams();
  if (stripeSessionId) returnParams.set("stripe_session_id", stripeSessionId);
  if (typeof sp.payment === "string") returnParams.set("payment", sp.payment);
  const returnPath = `/bookings/${encodeURIComponent(id)}${returnParams.size ? `?${returnParams}` : ""}`;
  const user=await getCurrentUser();
  if(!user)redirect(`/account?next=${encodeURIComponent(returnPath)}`);
  const b = await getBooking(id,user.id);
  if (!b) notFound();
  const provider = (b as typeof b & { paymentProvider?: string }).paymentProvider;
  const paymentLabel = b.refundStatus === "failed" ? "Refund needs support review" : b.paymentStatus === "paid" ? "Payment received" : b.paymentStatus === "refund_pending" ? "Refund processing" : b.paymentStatus === "refunded" ? "Refund confirmed" : b.status === "cancelled" ? "No payment collected" : b.paymentStatus === "failed" ? "Payment not completed" : b.payment === "cash" ? "Pay after service" : "Awaiting payment";
  const statusStyle = b.status === "cancelled" ? "bg-zinc-100 text-zinc-600" : b.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-700";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {sp.success && b.status==="confirmed" && (
        <Card className="border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-2 text-2xl font-bold text-emerald-950">Booking confirmed!</h1>
          <p className="mt-1 text-sm text-emerald-700">
            Your service is booked for {b.date} at {b.slot}. Our team will coordinate your professional.
          </p>
        </Card>
      )}

      <Card className="mt-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="max-w-full break-all font-mono text-sm font-semibold">{b.id}</h2>
          <Badge className={statusStyle}>{b.status.toUpperCase()}</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Booked {new Date(b.createdAt).toLocaleString("en-IN")}</p>
        <Separator className="my-4" />
        <div className="space-y-3">
          {b.items.map((i) => (
            <div key={i.slug} className="flex justify-between text-sm">
              <span className="font-semibold">{i.title} <span className="text-zinc-400">× {i.qty}</span></span>
              <b>{formatINR(i.price * i.qty)}</b>
            </div>
          ))}
        </div>
        <Separator className="my-4" />
        <div className="space-y-1.5 text-sm">
          <p className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span>{formatINR(b.subtotal)}</span></p>
          <p className="flex justify-between text-emerald-600"><span>Discount</span><span>− {formatINR(b.discount)}</span></p>
          <p className="flex justify-between"><span className="text-zinc-500">Visit fee</span><span>{b.visitFee === 0 ? "FREE" : formatINR(b.visitFee)}</span></p>
          <p className="flex justify-between pt-1 text-lg font-bold"><span>Total</span><span>{formatINR(b.total)}</span></p>
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><CalendarDays className="h-4 w-4 text-violet-600" /> Slot</p>
          <p className="mt-1 text-zinc-600">{b.date} · {b.slot}</p>
          <p className="mt-3 flex items-center gap-1.5 font-semibold"><Wallet className="h-4 w-4 text-violet-600" /> Payment</p>
          <p className="mt-1 text-zinc-600">{b.payment.toUpperCase()} · {paymentLabel}</p>
          {provider && b.payment !== "cash" && <p className="mt-2 text-xs text-zinc-500">Processed through {provider === "stripe" ? "Stripe" : "Razorpay"}</p>}
        </Card>
        <Card className="p-5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><MapPin className="h-4 w-4 text-violet-600" /> Address</p>
          <p className="mt-1 text-zinc-600">{b.name} · <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{b.phone}</span></p>
          <p className="mt-1 text-zinc-600">{b.address}</p>
        </Card>
      </div>

      <LocationLink source="catalog" id={b.id}/>
      <BookingActions booking={b} stripeSessionId={stripeSessionId} paymentReturn={typeof sp.payment === "string" ? sp.payment : undefined}/>
      <div className="mt-6 flex gap-2">
        <Link href="/bookings" className="flex-1"><Button variant="outline" className="w-full">All bookings</Button></Link>
        <Link href="/#categories" className="flex-1"><Button variant="brand" className="w-full">Book more <ArrowRight className="h-4 w-4" /></Button></Link>
      </div>
    </div>
  );
}

