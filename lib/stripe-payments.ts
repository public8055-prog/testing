import { initDb } from "@/lib/db";
import { mongoCollection, withMongoTransaction } from "@/lib/mongo";
import { HttpError } from "@/lib/http";
import { verifyHmacSignature } from "@/lib/payment-signatures";
import { requestBookingRefund, reconcileProviderRefund } from "@/lib/refunds";

type StripeBooking = { id: string; user_id: string; total: number; payment: string; status: string; payment_status: string; payment_provider: string | null; stripe_session_id: string | null; stripe_payment_intent_id: string | null; stripe_checkout_url: string | null; razorpay_order_id: string | null; updated_at:string;payment_version?:number };
type StripeIntent = { id: string; status: string; amount: number; amount_received: number; currency: string; metadata?: { booking_id?: string } };
type StripeSession = { id: string; url: string | null; mode: string; status: string; payment_status: string; amount_total: number; currency: string; livemode: boolean; client_reference_id: string; metadata?: { booking_id?: string }; payment_intent: StripeIntent | string | null };

function appOrigin() {
  try {
    const url = new URL(process.env.APP_URL || "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new HttpError(503, "Configure APP_URL before enabling card checkout."); }
}

export function stripeConfig() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() || "";
  let originConfigured = true;
  try { appOrigin(); } catch { originConfigured = false; }
  return { enabled: /^sk_(test|live)_[A-Za-z0-9]+$/.test(secret) && originConfigured, testMode: secret.startsWith("sk_test_") };
}

function secretKey() {
  if (!stripeConfig().enabled) throw new HttpError(503, "Stripe card payments are not configured.");
  return process.env.STRIPE_SECRET_KEY!.trim();
}

async function stripe<T>(path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<T> {
  const secret = secretKey();
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": "2024-06-20", "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: body?.toString(),
    });
  } catch { throw new HttpError(502, "Card checkout could not be reached. Retry this booking; its payment provider is unchanged."); }
  if (!response.ok) throw new HttpError(502, "The card provider could not complete this request. Please retry this booking shortly.");
  return response.json() as Promise<T>;
}

function paise(total: number) {
  const amount = Math.round(Number(total) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) throw new HttpError(400, "Invalid booking amount.");
  return amount;
}

function checkoutUrl(value: string | null) {
  try { const url = new URL(value || ""); if (url.protocol === "https:" && url.hostname === "checkout.stripe.com") return url.href; } catch { /* validated below */ }
  throw new HttpError(502, "The card provider returned an invalid checkout URL.");
}

async function owned(bookingId: string, userId: string) {
  await initDb();
  const booking=await(await mongoCollection<StripeBooking>("bookings")).findOne({id:bookingId,user_id:userId});
  if (!booking) throw new HttpError(404, "Booking not found.");
  return booking;
}

function assertSessionBinding(session: StripeSession, booking: StripeBooking) {
  if (session.mode !== "payment" || session.client_reference_id !== booking.id || session.metadata?.booking_id !== booking.id || session.amount_total !== paise(booking.total) || session.currency !== "inr" || session.livemode !== !stripeConfig().testMode) {
    throw new HttpError(400, "Stripe checkout details do not match this booking.");
  }
}

export async function createStripeCheckout(bookingId: string, userId: string) {
  secretKey();
  const booking = await owned(bookingId, userId);
  if (booking.status !== "pending" || booking.payment_status !== "unpaid" || booking.payment !== "card") throw new HttpError(409, "This booking is not awaiting card payment.");
  if ((booking.payment_provider && booking.payment_provider !== "stripe") || booking.razorpay_order_id) throw new HttpError(409, "This booking already uses another payment provider.");
  const bookings=await mongoCollection<StripeBooking>("bookings");
  const pinned=await bookings.updateOne({id:bookingId,user_id:userId,status:"pending",payment_status:"unpaid",payment_provider:{$in:[null,"stripe"]},razorpay_order_id:null},{$set:{payment_provider:"stripe"}});
  if (!pinned.matchedCount) throw new HttpError(409, "The booking payment provider changed. Refresh before retrying.");
  const amount = paise(booking.total);
  let session: StripeSession;
  if (booking.stripe_session_id) {
    session = await stripe<StripeSession>(`checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}`);
  } else {
    const origin = appOrigin();
    const body = new URLSearchParams({
      mode: "payment", "payment_method_types[0]": "card", client_reference_id: booking.id,
      "metadata[booking_id]": booking.id, "payment_intent_data[metadata][booking_id]": booking.id,
      "payment_intent_data[capture_method]": "automatic",
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "inr",
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": "UrbanKare home service booking",
      success_url: `${origin}/bookings/${encodeURIComponent(booking.id)}?stripe_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/bookings/${encodeURIComponent(booking.id)}?payment=pending`,
    });
    // The stable payload and key survive network timeouts and concurrent requests.
    // Keep the provider pinned even when the outcome of this call is uncertain.
    session = await stripe<StripeSession>("checkout/sessions", body, `urbankare-checkout-${booking.id}-v1`);
  }
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(session.id)) throw new HttpError(502, "Invalid Stripe checkout session.");
  assertSessionBinding(session, booking);
  if (session.status !== "open" || session.payment_status !== "unpaid") throw new HttpError(409, "This checkout has completed or expired. Refresh your booking to see its payment status.");
  const url = checkoutUrl(session.url);
  const saved=await bookings.updateOne({id:booking.id,payment_provider:"stripe",status:"pending",payment_status:"unpaid",stripe_session_id:{$in:[null,session.id]}},{$set:{stripe_session_id:session.id,stripe_checkout_url:url,updated_at:new Date().toISOString()}});
  if (!saved.matchedCount) throw new HttpError(409, "The booking changed while checkout opened. Refresh your booking.");
  return { gateway: "stripe" as const, checkoutUrl: url, bookingId, sessionId: session.id };
}

async function confirmSession(session: StripeSession, booking: StripeBooking, eventId: string) {
  assertSessionBinding(session, booking);
  if (session.id !== booking.stripe_session_id || booking.payment_provider !== "stripe") throw new HttpError(400, "Stripe session does not match this booking.");
  const intent = session.payment_intent;
  if (session.status !== "complete" || session.payment_status !== "paid" || !intent || typeof intent === "string" || !/^pi_[A-Za-z0-9]+$/.test(intent.id) || intent.status !== "succeeded" || intent.amount !== paise(booking.total) || intent.amount_received !== paise(booking.total) || intent.currency !== "inr" || intent.metadata?.booking_id !== booking.id) {
    throw new HttpError(409, "Card payment is awaiting captured-payment confirmation. Do not pay again.");
  }
  const bookings=await mongoCollection<StripeBooking>("bookings"),events=await mongoCollection<{id:string;created_at:string;booking_id:string}>("payment_events");
  await withMongoTransaction(async txSession => {
    const current=await bookings.findOneAndUpdate({id:booking.id},{$inc:{payment_version:1}},{session:txSession,returnDocument:"after"});
    if (!current || current.stripe_session_id !== session.id || current.payment_provider !== "stripe") throw new HttpError(409, "Booking payment details changed.");
    assertSessionBinding(session, current);
    if (current.stripe_payment_intent_id && current.stripe_payment_intent_id !== intent.id) throw new HttpError(409, "A different card payment was already recorded.");
    if(await events.findOne({id:eventId},{session:txSession,projection:{_id:1}}))return;
    await events.insertOne({_id:eventId,id:eventId,booking_id:booking.id,created_at:new Date().toISOString()},{session:txSession});
    await bookings.updateOne({id:booking.id,stripe_session_id:session.id,payment_provider:"stripe",payment_status:"unpaid",stripe_payment_intent_id:{$in:[null,intent.id]}},{$set:{stripe_payment_intent_id:intent.id,payment_status:current.status==="cancelled"?"refund_pending":"paid",status:current.status==="pending"?"confirmed":current.status,updated_at:new Date().toISOString()}},{session:txSession});
  });
  const current=await bookings.findOne({id:booking.id});
  if (current?.status === "cancelled" && current.payment_status === "refund_pending") await requestBookingRefund(booking.id);
  const latest=await bookings.findOne({id:booking.id});
  if(!latest)throw new HttpError(404,"Booking not found.");
  return { verified: true, bookingId: booking.id, status: latest.status, paymentStatus: latest.payment_status };
}

export async function verifyStripeCheckout(bookingId: string, sessionId: string, userId: string) {
  const booking = await owned(bookingId, userId);
  if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId) || sessionId !== booking.stripe_session_id || booking.payment_provider !== "stripe") throw new HttpError(400, "Stripe session does not match this booking.");
  const session = await stripe<StripeSession>(`checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`);
  return confirmSession(session, booking, `stripe-verify:${session.id}`);
}

export function verifyStripeWebhookSignature(raw: string, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const times = parts.filter(([key]) => key === "t").map(([, value]) => value);
  if (times.length !== 1 || !/^\d+$/.test(times[0]) || Math.abs(nowSeconds - Number(times[0])) > 300) return false;
  return parts.filter(([key]) => key === "v1").some(([, signature]) => verifyHmacSignature(`${times[0]}.${raw}`, signature || "", secret));
}

export async function processStripeWebhook(raw: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(503, "Stripe webhook is not configured.");
  if (!verifyStripeWebhookSignature(raw, signature, secret)) throw new HttpError(400, "Invalid Stripe webhook signature or timestamp.");
  let event: { id: string; type: string; data?: { object?: { id?: string } } };
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, "Invalid Stripe webhook payload."); }
  if (!event || !/^evt_[A-Za-z0-9]+$/.test(event.id)) throw new HttpError(400, "Invalid Stripe event.");
  const id = event.data?.object?.id;
  if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    if (!id || !/^re_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, "Invalid Stripe refund event.");
    await reconcileProviderRefund("stripe", id);
    return { received: true };
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return { received: true, ignored: true };
  if (!id || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, "Invalid Stripe session event.");
  await initDb();
  const booking=await(await mongoCollection<StripeBooking>("bookings")).findOne({stripe_session_id:id,payment_provider:"stripe"});
  if (!booking) return { received: true, ignored: true };
  const session = await stripe<StripeSession>(`checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent`);
  if (session.payment_status !== "paid") return { received: true, pending: true };
  await confirmSession(session, booking, `stripe-webhook:${event.id}`);
  return { received: true };
}
