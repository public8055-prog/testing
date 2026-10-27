import { initDb } from "@/lib/db";
import { mongoCollection } from "@/lib/mongo";
import { HttpError } from "@/lib/http";
import { createPaymentOrder, paymentConfig as razorpayConfig } from "@/lib/payments";
import { createStripeCheckout, stripeConfig } from "@/lib/stripe-payments";

export type Gateway = "razorpay" | "stripe";
export function selectPaymentGateway(method: string, available: { razorpay: boolean; stripe: boolean }, preference: string = "razorpay", pinned?: string | null): Gateway {
  if (method !== "upi" && method !== "card") throw new HttpError(400, "Choose card or UPI for online payment.");
  if (pinned) {
    if (pinned !== "razorpay" && pinned !== "stripe") throw new HttpError(409, "Unknown payment provider on this booking.");
    if (method === "upi" && pinned !== "razorpay") throw new HttpError(409, "This booking cannot use UPI.");
    if (!available[pinned]) throw new HttpError(503, "This booking's payment provider is temporarily unavailable. Please retry later.");
    return pinned;
  }
  if (method === "upi") {
    if (!available.razorpay) throw new HttpError(503, "UPI is currently unavailable. Select card or pay after service.");
    return "razorpay";
  }
  const preferred: Gateway = preference === "stripe" ? "stripe" : "razorpay";
  if (available[preferred]) return preferred;
  const fallback: Gateway = preferred === "stripe" ? "razorpay" : "stripe";
  if (available[fallback]) return fallback;
  throw new HttpError(503, "Online payments are not configured. Select pay after service.");
}

export function paymentConfig() {
  const razorpay = razorpayConfig();
  const stripe = stripeConfig();
  const enabled = razorpay.enabled || stripe.enabled;
  const preferredGateway = enabled ? selectPaymentGateway("card", { razorpay: razorpay.enabled, stripe: stripe.enabled }, process.env.PAYMENT_GATEWAY_PREFERENCE) : null;
  return { enabled, keyId: razorpay.keyId, testMode: preferredGateway === "stripe" ? stripe.testMode : razorpay.testMode, gateways: { razorpay: { enabled: razorpay.enabled, testMode: razorpay.testMode }, stripe }, methods: { upi: razorpay.enabled, card: enabled }, preferredGateway };
}

export async function createPaymentCheckout(bookingId: string, userId: string) {
  await initDb();
  const booking = await (await mongoCollection<{id:string;user_id:string;payment:string;payment_provider:string|null;razorpay_order_id:string|null;stripe_session_id:string|null}>("bookings")).findOne({id:bookingId,user_id:userId});
  if (!booking) throw new HttpError(404, "Booking not found.");
  const config = paymentConfig();
  const pinned = booking.payment_provider || (booking.stripe_session_id ? "stripe" : booking.razorpay_order_id ? "razorpay" : null);
  const gateway = selectPaymentGateway(booking.payment, { razorpay: config.gateways.razorpay.enabled, stripe: config.gateways.stripe.enabled }, process.env.PAYMENT_GATEWAY_PREFERENCE, pinned);
  // Never fail over after an attempted external create: the outcome may be uncertain.
  return gateway === "stripe" ? createStripeCheckout(bookingId, userId) : { gateway: "razorpay" as const, ...await createPaymentOrder(bookingId, userId) };
}
