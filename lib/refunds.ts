import { createHash, randomUUID } from "node:crypto";
import { initDb } from "./db";
import { mongoCollection, withMongoTransaction } from "./mongo";

export type RefundGateway = "stripe" | "razorpay";
type RefundRow = { booking_id: string; gateway: RefundGateway; payment_id: string; amount: number; status: string; provider_refund_id: string | null; attempts: number; created_at: string;updated_at:string;next_attempt_at:string;last_error?:string|null };
type ProviderRefund = { id: string; amount: number; currency: string; status: string; payment_id?: string; payment_intent?: string };
type RefundBooking = { id: string; total: number; payment: string; status: string; payment_status: string; payment_provider: string | null; razorpay_payment_id: string | null; stripe_payment_intent_id: string | null;payment_version?:number;updated_at:string;created_at:string };
const pendingMessage = "Refund is awaiting payment-provider confirmation. We will retry automatically.";
const failedMessage = "The payment provider could not complete the refund. Support review is required.";
const idempotencyKey = (row: RefundRow) => `refund_${createHash("sha256").update(`${row.gateway}:${row.booking_id}`).digest("hex").slice(0, 32)}`;

function providerHeaders(gateway: RefundGateway): Record<string, string> {
  if (gateway === "stripe") {
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secret) throw new Error("Refund provider is not configured.");
    return { Authorization: `Bearer ${secret}` };
  }
  const key = process.env.RAZORPAY_KEY_ID?.trim();
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key || !secret) throw new Error("Refund provider is not configured.");
  return { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` };
}

async function providerRequest<T>(gateway: RefundGateway, endpoint: string, options: RequestInit = {}): Promise<T> {
  const base = gateway === "stripe" ? "https://api.stripe.com/v1/" : "https://api.razorpay.com/v1/";
  const response = await fetch(base + endpoint, { ...options, headers: { ...providerHeaders(gateway), ...options.headers }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Refund provider request failed (${response.status}).`);
  return await response.json() as T;
}

function validRefund(row: RefundRow, refund: ProviderRefund) {
  const paymentId = row.gateway === "stripe" ? refund.payment_intent : refund.payment_id;
  const validId = row.gateway === "stripe" ? /^re_[A-Za-z0-9]+$/.test(refund.id) : /^rfnd_[A-Za-z0-9]+$/.test(refund.id);
  if (!validId || paymentId !== row.payment_id || Number(refund.amount) !== Number(row.amount) || refund.currency?.toUpperCase() !== "INR") throw new Error("Refund response does not match the booking payment.");
}

async function enqueue(bookingId: string) {
  const bookings=await mongoCollection<RefundBooking>("bookings"),refunds=await mongoCollection<RefundRow>("payment_refunds");
  return withMongoTransaction(async session => {
    const booking=await bookings.findOneAndUpdate({id:bookingId},{$inc:{payment_version:1}},{session,returnDocument:"after"});
    if (!booking || booking.status !== "cancelled" || !["paid", "refund_pending"].includes(booking.payment_status) || ["cash", "cod", "pay_after_service"].includes(booking.payment)) return false;
    const gateway = booking.payment_provider || (booking.stripe_payment_intent_id ? "stripe" : booking.razorpay_payment_id ? "razorpay" : null);
    if (gateway !== "stripe" && gateway !== "razorpay") return false;
    const paymentId = gateway === "stripe" ? booking.stripe_payment_intent_id : booking.razorpay_payment_id;
    if (!paymentId || !(gateway === "stripe" ? /^pi_[A-Za-z0-9]+$/ : /^pay_[A-Za-z0-9]+$/).test(paymentId)) return false;
    const amount = Math.round(Number(booking.total) * 100);
    if (!Number.isSafeInteger(amount) || amount < 1) return false;
    const now = new Date().toISOString();
    await refunds.updateOne({booking_id:bookingId},{$setOnInsert:{_id:bookingId,booking_id:bookingId,gateway,payment_id:paymentId,amount,status:"pending",provider_refund_id:null,attempts:0,next_attempt_at:now,updated_at:now,created_at:now}},{session,upsert:true});
    await bookings.updateOne({id:bookingId,status:"cancelled",payment_status:"paid"},{$set:{payment_status:"refund_pending",payment_provider:gateway,updated_at:now}},{session});
    return true;
  });
}

async function applyProviderState(row: RefundRow, refund: ProviderRefund, claimAttempt?: number) {
  validRefund(row, refund);
  const succeeded = refund.status === (row.gateway === "stripe" ? "succeeded" : "processed");
  const failed = ["failed", "canceled", "cancelled"].includes(refund.status);
  const status = succeeded ? "succeeded" : failed ? "failed" : "pending";
  const now = new Date().toISOString();
  const bookings=await mongoCollection<RefundBooking>("bookings"),refunds=await mongoCollection<RefundRow>("payment_refunds"),events=await mongoCollection<{id:string;booking_id:string;type:string;payload:string;created_at:string}>("booking_events");
  return withMongoTransaction(async session => {
    // Use the same booking-before-refund lock order as queue creation and payment capture.
    await bookings.updateOne({id:row.booking_id},{$inc:{payment_version:1}},{session});
    const changed=await refunds.updateOne({booking_id:row.booking_id,gateway:row.gateway,payment_id:row.payment_id,amount:row.amount,provider_refund_id:{$in:[null,refund.id]},...(claimAttempt===undefined?{status:{$ne:"succeeded"}}:{status:"processing",attempts:claimAttempt})},{$set:{provider_refund_id:refund.id,status,last_error:succeeded?null:failed?failedMessage:pendingMessage,next_attempt_at:new Date(Date.now()+(failed?3600000:60000)).toISOString(),updated_at:now}},{session});
    if (changed.matchedCount && succeeded) {
      await bookings.updateOne({id:row.booking_id,status:"cancelled",payment_status:{$in:["paid","refund_pending"]}},{$set:{payment_status:"refunded",updated_at:now}},{session});
      const id=randomUUID();await events.insertOne({_id:id,id,booking_id:row.booking_id,type:"payment.refunded",payload:JSON.stringify({gateway:row.gateway,refundId:refund.id,amount:row.amount}),created_at:now},{session});
    }
    return status;
  });
}

async function loadOrCreateRefund(row: RefundRow): Promise<ProviderRefund> {
  if (row.provider_refund_id) return providerRequest(row.gateway, `refunds/${encodeURIComponent(row.provider_refund_id)}`);
  // Recover a response lost before persistence, including after an idempotency retention window.
  const list = row.gateway === "stripe"
    ? await providerRequest<{ data: ProviderRefund[] }>(row.gateway, `refunds?payment_intent=${encodeURIComponent(row.payment_id)}&limit=100`).then((value) => value.data)
    : await providerRequest<{ items: ProviderRefund[] }>(row.gateway, `payments/${encodeURIComponent(row.payment_id)}/refunds?count=100`).then((value) => value.items);
  if (!Array.isArray(list)) throw new Error("Refund provider returned an invalid list.");
  const existing = list.find((refund) => Number(refund.amount) === Number(row.amount) && (row.gateway === "stripe" ? refund.payment_intent : refund.payment_id) === row.payment_id);
  if (existing) return existing;
  const key = idempotencyKey(row);
  if (row.gateway === "stripe") {
    const body = new URLSearchParams({ payment_intent: row.payment_id, amount: String(row.amount), reason: "requested_by_customer", "metadata[booking_id]": row.booking_id });
    return providerRequest(row.gateway, "refunds", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key }, body: body.toString() });
  }
  // https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/
  return providerRequest(row.gateway, `payments/${encodeURIComponent(row.payment_id)}/refund`, { method: "POST", headers: { "Content-Type": "application/json", "X-Refund-Idempotency": key }, body: JSON.stringify({ amount: Number(row.amount), speed: "normal", receipt: key, notes: { booking_id: row.booking_id } }) });
}

async function processOne(bookingId: string): Promise<"succeeded" | "pending" | "failed" | "skipped"> {
  const now = new Date().toISOString();
  const refunds=await mongoCollection<RefundRow>("payment_refunds"),bookings=await mongoCollection<RefundBooking>("bookings");
  const row=await refunds.findOneAndUpdate({booking_id:bookingId,$or:[{status:"pending",next_attempt_at:{$lte:now}},{status:"processing",updated_at:{$lt:new Date(Date.now()-120000).toISOString()}}]},{$set:{status:"processing",updated_at:now},$inc:{attempts:1}},{returnDocument:"after"});
  if (!row) return "skipped";
  try {
    const booking=await bookings.findOne({id:row.booking_id});
    const paymentId = row.gateway === "stripe" ? booking?.stripe_payment_intent_id : booking?.razorpay_payment_id;
    if (!booking || booking.status !== "cancelled" || !["paid", "refund_pending"].includes(booking.payment_status) || ["cash", "cod", "pay_after_service"].includes(booking.payment) || paymentId !== row.payment_id || Math.round(Number(booking.total) * 100) !== Number(row.amount)) {
      await refunds.updateOne({booking_id:row.booking_id,status:"processing",attempts:row.attempts},{$set:{status:"failed",last_error:"Refund eligibility changed. Support review is required.",updated_at:new Date().toISOString()}});
      return "failed";
    }
    const refund = await loadOrCreateRefund(row);
    return await applyProviderState(row, refund, row.attempts) as "succeeded" | "pending" | "failed";
  } catch {
    // Never include raw provider bodies/credentials in customer-visible diagnostics.
    const next = new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(Number(row.attempts), 7))).toISOString();
    await refunds.updateOne({booking_id:row.booking_id,status:"processing",attempts:row.attempts},{$set:{status:"pending",last_error:pendingMessage,next_attempt_at:next,updated_at:new Date().toISOString()}});
    return "pending";
  }
}

/** Persist first, then make a best-effort attempt; provider failures remain queued. */
export async function requestBookingRefund(bookingId: string): Promise<void> {
  await initDb();
  if (await enqueue(bookingId)) await processOne(bookingId);
}

export async function processPendingRefunds(): Promise<{ discovered: number; processed: number; succeeded: number; pending: number; failed: number }> {
  await initDb();
  const bookings=await mongoCollection<RefundBooking>("bookings"),refunds=await mongoCollection<RefundRow>("payment_refunds");
  const missed=await bookings.aggregate<{id:string}>([{$match:{status:"cancelled",payment_status:{$in:["paid","refund_pending"]},payment:{$nin:["cash","cod","pay_after_service"]},total:{$gt:0},$or:[{razorpay_payment_id:{$type:"string"}},{stripe_payment_intent_id:{$type:"string"}}]}},{$lookup:{from:"payment_refunds",localField:"id",foreignField:"booking_id",as:"refund"}},{$match:{"refund.0":{$exists:false}}},{$sort:{created_at:1}},{$limit:100},{$project:{_id:0,id:1}}]).toArray();
  let discovered = 0;
  for (const booking of missed) if (await enqueue(booking.id)) discovered++;
  const due=await refunds.find({$or:[{status:"pending",next_attempt_at:{$lte:new Date().toISOString()}},{status:"processing",updated_at:{$lt:new Date(Date.now()-120000).toISOString()}}]},{projection:{booking_id:1}}).sort({next_attempt_at:1}).limit(25).toArray();
  const summary = { discovered, processed: 0, succeeded: 0, pending: 0, failed: 0 };
  // Keep provider concurrency bounded independently of the web application's traffic.
  for (let index = 0; index < due.length; index += 5) {
    const results = await Promise.all(due.slice(index,index+5).map((row) => processOne(row.booking_id)));
    for (const result of results) if (result !== "skipped") { summary.processed++; summary[result]++; }
  }
  return summary;
}

/** Webhook payloads supply only an ID; trusted provider API data supplies the state. */
export async function reconcileProviderRefund(gateway: RefundGateway, providerRefundId: string): Promise<{ matched: boolean }> {
  if (!(gateway === "stripe" ? /^re_[A-Za-z0-9]+$/ : /^rfnd_[A-Za-z0-9]+$/).test(providerRefundId)) throw new Error("Invalid refund identifier.");
  await initDb();
  const refund = await providerRequest<ProviderRefund>(gateway, `refunds/${encodeURIComponent(providerRefundId)}`);
  if (refund.id !== providerRefundId) throw new Error("Refund identifier does not match.");
  const paymentId = gateway === "stripe" ? refund.payment_intent : refund.payment_id;
  const row=await(await mongoCollection<RefundRow>("payment_refunds")).findOne({gateway,payment_id:paymentId||"",provider_refund_id:{$in:[null,providerRefundId]}});
  if (!row) return { matched: false };
  await applyProviderState(row, refund);
  return { matched: true };
}
