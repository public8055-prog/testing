import { createHash, randomUUID } from "node:crypto";
import { initDb } from "@/lib/db";
import { mongoCollection, withMongoTransaction } from "@/lib/mongo";
import { HttpError } from "@/lib/http";
import { verifyHmacSignature, verifyPaymentSignature } from "@/lib/payment-signatures";
import { requestBookingRefund, reconcileProviderRefund } from "@/lib/refunds";

type PaymentBooking = {
  id: string;
  user_id: string;
  total: number;
  payment: string;
  status: string;
  payment_status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  payment_provider: string | null;
  stripe_session_id: string | null;
  updated_at: string;
  payment_version?: number;
};

type RazorpayOrder = { id: string; amount: number; currency: string };
type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
};

export function paymentConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const enabled = /^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) && Boolean(process.env.RAZORPAY_KEY_SECRET?.trim());
  return { enabled, keyId: enabled ? keyId : null, testMode: keyId.startsWith("rzp_test_") };
}

function credentials() {
  const config = paymentConfig();
  if (!config.enabled || !config.keyId) {
    throw new HttpError(503, "Online payments are not configured yet. Please select pay after service.");
  }
  return { keyId: config.keyId, secret: process.env.RAZORPAY_KEY_SECRET!.trim() };
}

async function razorpay<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const { keyId, secret } = credentials();
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "The payment provider could not be reached. Please retry shortly.");
  }
  if (!response.ok) throw new HttpError(502, "The payment provider could not complete this request. Please retry shortly.");
  return response.json() as Promise<T>;
}

function amountInPaise(total: number) {
  const amount = Math.round(Number(total) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) throw new HttpError(400, "This booking has an invalid payment amount.");
  return amount;
}

async function ownedBooking(bookingId: string, userId: string) {
  await initDb();
  const booking = await (await mongoCollection<PaymentBooking>("bookings")).findOne({id:bookingId,user_id:userId});
  if (!booking) throw new HttpError(404, "Booking not found.");
  return booking;
}

export async function createPaymentOrder(bookingId: string, userId: string) {
  const { keyId } = credentials();
  const booking = await ownedBooking(bookingId, userId);
  if (booking.payment_status !== "unpaid" || booking.status !== "pending") {
    throw new HttpError(409, "This booking is not awaiting payment.");
  }
  if (booking.payment === "cash") throw new HttpError(409, "This booking uses pay after service.");
  if ((booking.payment_provider && booking.payment_provider !== "razorpay") || booking.stripe_session_id) {
    throw new HttpError(409, "Continue payment through the checkout already linked to this booking.");
  }
  const bookings=await mongoCollection<PaymentBooking>("bookings");
  const pinned = await bookings.updateOne({id:bookingId,user_id:userId,status:"pending",payment_status:"unpaid",payment_provider:{$in:[null,"razorpay"]},stripe_session_id:null},{$set:{payment_provider:"razorpay"}});
  if (!pinned.matchedCount) throw new HttpError(409, "Payment checkout has changed. Refresh this booking.");
  const amount = amountInPaise(booking.total);
  if (booking.razorpay_order_id?.startsWith("order_")) {
    return { keyId, orderId: booking.razorpay_order_id, amount, currency: "INR", bookingId };
  }

  // A database compare-and-set also serializes requests across application replicas.
  // Never keep a database transaction open while calling the payment provider.
  const claim = `claim_${randomUUID()}`;
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 60_000).toISOString();
  const lock = await bookings.updateOne({id:bookingId,user_id:userId,payment_provider:"razorpay",status:"pending",payment_status:"unpaid",$or:[{razorpay_order_id:null},{razorpay_order_id:/^claim_/,updated_at:{$lt:stale}}]},{$set:{razorpay_order_id:claim,updated_at:now}});
  if (!lock.matchedCount) throw new HttpError(409, "Payment checkout is already opening. Please retry in a moment.");
  try {
    const order = await razorpay<RazorpayOrder>("orders", "POST", {
      amount,
      currency: "INR",
      receipt: bookingId.slice(0, 40),
      notes: { booking_id: bookingId },
      partial_payment: false,
    });
    if (!/^order_[A-Za-z0-9]+$/.test(order.id) || order.amount !== amount || order.currency !== "INR") {
      throw new HttpError(502, "The payment provider returned an invalid order.");
    }
    const saved = await bookings.updateOne({id:bookingId,razorpay_order_id:claim,status:"pending",payment_status:"unpaid"},{$set:{razorpay_order_id:order.id,updated_at:new Date().toISOString()}});
    if (!saved.matchedCount) throw new HttpError(409, "The booking changed while checkout was opening. Please refresh.");
    return { keyId, orderId: order.id, amount, currency: "INR", bookingId };
  } catch (error) {
    await bookings.updateOne({id:bookingId,razorpay_order_id:claim},{$set:{razorpay_order_id:null,updated_at:new Date().toISOString()}});
    throw error;
  }
}

function assertCapturedPayment(payment: RazorpayPayment, booking: PaymentBooking) {
  if (booking.payment === "cash" || (booking.payment_provider && booking.payment_provider !== "razorpay") || booking.stripe_session_id) {
    throw new HttpError(400, "Payment provider does not match this booking.");
  }
  if (payment.order_id !== booking.razorpay_order_id || payment.amount !== amountInPaise(booking.total) || payment.currency !== "INR") {
    throw new HttpError(400, "Payment details do not match this booking.");
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    throw new HttpError(409, "Your payment is awaiting confirmation. Check the booking again shortly; do not pay again.");
  }
}

async function recordCapturedPayment(booking: PaymentBooking, payment: RazorpayPayment, eventId: string) {
  const bookings=await mongoCollection<PaymentBooking>("bookings"),events=await mongoCollection<{id:string;created_at:string;booking_id:string}>("payment_events");
  return withMongoTransaction(async session => {
    const current=await bookings.findOneAndUpdate({id:booking.id},{$inc:{payment_version:1}},{session,returnDocument:"after"});
    if (!current) throw new HttpError(404, "Booking not found.");
    assertCapturedPayment(payment, current);
    if (current.razorpay_payment_id && current.razorpay_payment_id !== payment.id) {
      throw new HttpError(409, "A different payment has already been recorded for this booking.");
    }
    if(await events.findOne({id:eventId},{session,projection:{_id:1}}))return{duplicate:true};
    await events.insertOne({_id:eventId,id:eventId,booking_id:booking.id,created_at:new Date().toISOString()},{session});
    // Captures and cancellations write the same document; transaction retries see the latest state.
    await bookings.updateOne({id:booking.id,razorpay_order_id:payment.order_id,payment_status:"unpaid",razorpay_payment_id:{$in:[null,payment.id]}},{$set:{payment_provider:"razorpay",payment_status:current.status==="cancelled"?"refund_pending":"paid",status:current.status==="pending"?"confirmed":current.status,razorpay_payment_id:payment.id,updated_at:new Date().toISOString()}},{session});
    return { duplicate: false };
  });
}

export async function verifyCheckoutPayment(input: { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }, userId: string) {
  const { secret } = credentials();
  const booking = await ownedBooking(input.bookingId, userId);
  if (!booking.razorpay_order_id?.startsWith("order_") || booking.razorpay_order_id !== input.razorpay_order_id) {
    throw new HttpError(400, "Payment order does not match this booking.");
  }
  if (!verifyPaymentSignature(booking.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, secret)) {
    throw new HttpError(400, "Payment signature verification failed.");
  }
  const payment = await razorpay<RazorpayPayment>(`payments/${encodeURIComponent(input.razorpay_payment_id)}`);
  if (payment.id !== input.razorpay_payment_id) throw new HttpError(400, "Payment does not match.");
  assertCapturedPayment(payment, booking);
  await recordCapturedPayment(booking, payment, `verify:${payment.id}`);
  await requestBookingRefund(booking.id);
  const current = await ownedBooking(booking.id, userId);
  return { verified: true, bookingId: booking.id, status: current.status, paymentStatus: current.payment_status };
}

export async function processPaymentWebhook(raw: string, signature: string, eventHeader: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(503, "Payment webhook is not configured.");
  if (!verifyHmacSignature(raw, signature, secret)) throw new HttpError(400, "Invalid webhook signature.");
  let event: { event?: string; payload?: { payment?: { entity?: RazorpayPayment }; refund?: { entity?: { id?: string } } } };
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, "Invalid webhook payload."); }
  if (!event || typeof event !== "object") throw new HttpError(400, "Invalid webhook payload.");
  if (["refund.created", "refund.processed", "refund.failed"].includes(event.event ?? "")) {
    const refundId = event.payload?.refund?.entity?.id;
    if (typeof refundId !== "string" || !/^rfnd_[A-Za-z0-9]+$/.test(refundId)) throw new HttpError(400, "Invalid refund payload.");
    await reconcileProviderRefund("razorpay", refundId);
    return { received: true };
  }
  if (event.event !== "payment.captured" && event.event !== "order.paid") return { received: true, ignored: true };
  const payment = event.payload?.payment?.entity;
  if (!payment || !/^pay_[A-Za-z0-9]+$/.test(payment.id) || !/^order_[A-Za-z0-9]+$/.test(payment.order_id)) {
    throw new HttpError(400, "Invalid payment payload.");
  }
  await initDb();
  const booking=await(await mongoCollection<PaymentBooking>("bookings")).findOne({razorpay_order_id:payment.order_id});
  // Unrelated orders in a shared Razorpay account do not belong to this application.
  if (!booking) return { received: true, ignored: true };
  assertCapturedPayment(payment, booking);
  const eventId = `webhook:${eventHeader?.slice(0, 160) || createHash("sha256").update(raw).digest("hex")}`;
  const result = await recordCapturedPayment(booking, payment, eventId);
  await requestBookingRefund(booking.id);
  return { received: true, ...result };
}
