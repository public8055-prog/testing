import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mongoFixture } from "./helpers/mongo-fixture";
import { paymentConfig, createPaymentOrder, processPaymentWebhook } from "../lib/payments";

test("payment webhooks validate amounts, deduplicate, and never reopen cancelled bookings", async () => {
  const fixture=await mongoFixture("payments");
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = "isolated-test-webhook-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected real network request in isolated payment tests"); };
  const now = new Date().toISOString();
  const signature = (raw: string) => createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest("hex");
  const event = (order: string, payment: string, amount = 10000) => JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: payment, order_id: order, amount, currency: "INR", status: "captured", captured: true } } } });
  try {
    await fixture.seedUser("payment-test","payment@example.test");
    for (const [id, status, order] of [["payment-pending", "pending", "order_pending"], ["payment-cancelled", "cancelled", "order_cancelled"]]) {
      await fixture.seedBooking(id,"payment-test",{payment:"upi",status,razorpay_order_id:order,created_at:now,updated_at:now});
    }
    assert.equal(paymentConfig().enabled, false);
    await assert.rejects(createPaymentOrder("payment-pending", "payment-test"), /not configured/);
    const mismatched = event("order_pending", "pay_pending", 1);
    await assert.rejects(processPaymentWebhook(mismatched, signature(mismatched), "wrong-amount"), /do not match/);
    const raw = event("order_pending", "pay_pending");
    await assert.rejects(processPaymentWebhook(raw, "0".repeat(64), "bad-signature"), /Invalid webhook signature/);
    await Promise.all(Array.from({length:6},()=>processPaymentWebhook(raw,signature(raw),"captured-event")));
    const duplicate = await processPaymentWebhook(raw, signature(raw), "captured-event");
    assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
    const paid=await fixture.bookings.findOne({id:"payment-pending"},{projection:{_id:0,status:1,payment_status:1}});
    assert.deepEqual({ ...paid }, { status: "confirmed", payment_status: "paid" });
    const cancelled = event("order_cancelled", "pay_cancelled");
    await processPaymentWebhook(cancelled, signature(cancelled), "late-capture");
    const late=await fixture.bookings.findOne({id:"payment-cancelled"},{projection:{_id:0,status:1,payment_status:1}});
    assert.deepEqual({ ...late }, { status: "cancelled", payment_status: "refund_pending" });
    assert.equal(await fixture.paymentEvents.countDocuments(),2);
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});

test("Razorpay retries reuse an order and cannot open a Stripe or cash booking", async () => {
  const fixture=await mongoFixture("paymentorder");
  process.env.RAZORPAY_KEY_ID = "rzp_test_isolated";
  process.env.RAZORPAY_KEY_SECRET = "isolated-secret";
  const originalFetch = globalThis.fetch;
  const now = new Date().toISOString();
  let orders = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.razorpay.com/v1/orders");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.amount, 10000);
    orders++;
    return Response.json({ id: "order_reusable", amount: 10000, currency: "INR" });
  };
  try {
    await fixture.seedUser("order-test","orders@example.test");
    for (const [id, method, provider] of [["retry", "card", null], ["stripe-booking", "card", "stripe"], ["cash-booking", "cash", null]]) {
      await fixture.seedBooking(id!,"order-test",{payment:method,payment_provider:provider,created_at:now,updated_at:now});
    }
    const first = await createPaymentOrder("retry", "order-test");
    const second = await createPaymentOrder("retry", "order-test");
    assert.equal(first.orderId, second.orderId);
    assert.equal(orders, 1);
    await assert.rejects(createPaymentOrder("stripe-booking", "order-test"), /already linked/);
    await assert.rejects(createPaymentOrder("cash-booking", "order-test"), /pay after service/);
    await assert.rejects(createPaymentOrder("retry", "another-user"), /not found/);
    assert.equal(orders, 1);
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});
