"use client";
import { sessionFetch } from "@/lib/session-client";

import { openRazorpay, type RazorpayOrder } from "@/lib/razorpay-client";

export type PaymentConfiguration = {
  enabled: boolean;
  methods: { upi: boolean; card: boolean };
  gateways: { razorpay: { enabled: boolean; testMode: boolean }; stripe: { enabled: boolean; testMode: boolean } };
  preferredGateway?: "razorpay" | "stripe";
};

type PaymentBooking = { id: string; name?: string; phone?: string };
type PaymentCheckout = (RazorpayOrder & { gateway: "razorpay" }) | { gateway: "stripe"; checkoutUrl: string; sessionId: string; bookingId: string };

export async function openPayment(booking: PaymentBooking): Promise<{ redirected: boolean }> {
  const response = await sessionFetch("/api/payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Payment checkout is unavailable. Your booking is saved; please try again from its details.");
  const checkout = data as PaymentCheckout;
  if (checkout.bookingId !== booking.id) throw new Error("Payment details could not be matched to this booking. Please try again.");
  if (checkout.gateway === "stripe") {
    let url: URL;
    try { url = new URL(checkout.checkoutUrl); } catch { throw new Error("The payment checkout link is invalid. Please try again."); }
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) {
      throw new Error("The payment checkout link could not be verified. Please try again.");
    }
    window.location.assign(url.href);
    return { redirected: true };
  }
  if (checkout.gateway !== "razorpay") throw new Error("This payment option is currently unavailable.");
  await openRazorpay(booking, checkout);
  return { redirected: false };
}
