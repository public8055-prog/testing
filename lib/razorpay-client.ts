"use client";
import { sessionFetch } from "@/lib/session-client";

type CheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = { open: () => void; on: (event: string, callback: (response: { error?: { description?: string } }) => void) => void };
type CheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name?: string; contact?: string };
  theme: { color: string };
  modal: { ondismiss: () => void };
  handler: (response: CheckoutResponse) => void;
};

declare global { interface Window { Razorpay?: new (options: CheckoutOptions) => RazorpayInstance } }

let checkoutScript: Promise<void> | null = null;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScript) return checkoutScript;
  checkoutScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const timeout = window.setTimeout(() => {
      script.remove(); checkoutScript = null;
      reject(new Error("Payment checkout took too long to load. Please try again."));
    }, 15_000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.Razorpay) resolve();
      else { checkoutScript = null; reject(new Error("Payment checkout could not load.")); }
    };
    script.onerror = () => {
      window.clearTimeout(timeout); script.remove(); checkoutScript = null;
      reject(new Error("Payment checkout could not load. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return checkoutScript;
}

export type RazorpayOrder = { keyId: string; orderId: string; amount: number; currency: string; bookingId: string };

export async function openRazorpay(booking: { id: string; name?: string; phone?: string }, precreatedOrder?: RazorpayOrder): Promise<void> {
  let order = precreatedOrder;
  if (!order) {
  const response = await sessionFetch("/api/payments/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Payment checkout is unavailable.");
  order = data as RazorpayOrder;
  }
  if (!order || !order.keyId || !order.orderId || !Number.isFinite(order.amount) || order.amount <= 0) throw new Error("Payment details are invalid. Please try again.");
  const readyOrder = order;
  await loadCheckout();
  await new Promise<void>((resolve, reject) => {
    let verifying = false;
    const checkout = new window.Razorpay!({
      key: readyOrder.keyId,
      amount: readyOrder.amount,
      currency: readyOrder.currency,
      name: "UrbanKare",
      description: "Professional home services",
      order_id: readyOrder.orderId,
      prefill: { name: booking.name, contact: booking.phone },
      theme: { color: "#6d28d9" },
      modal: { ondismiss: () => { if (!verifying) reject(new Error("Payment checkout was closed. Your booking is saved; you can pay from its details.")); } },
      handler: async (payment) => {
        verifying = true;
        try {
          const result = await sessionFetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookingId: booking.id, ...payment }),
          });
          const data = await result.json();
          if (!result.ok) throw new Error(data.error || "Payment is awaiting confirmation. Check your booking before paying again.");
          if (data.paymentStatus === "refund_pending") throw new Error("Payment was received after cancellation. Your refund is being processed automatically to the original payment method.");
          if (data.paymentStatus === "refunded") throw new Error("This payment has been refunded to the original payment method.");
          if (!data.verified || data.paymentStatus !== "paid") throw new Error("Payment is still awaiting confirmation. Check your booking before paying again.");
          resolve();
        } catch (error) { reject(error); }
      },
    });
    // A failed attempt may be retried within the Razorpay dialog. Dismissal handles exit.
    checkout.open();
  });
}


