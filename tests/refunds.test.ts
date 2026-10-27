import test from "node:test";
import assert from "node:assert/strict";
import { getBooking, saveBooking } from "../lib/db";
import { mongoFixture } from "./helpers/mongo-fixture";
import { processPendingRefunds, reconcileProviderRefund, requestBookingRefund } from "../lib/refunds";

process.env.STRIPE_SECRET_KEY = "sk_test_mock_only";
process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
process.env.RAZORPAY_KEY_SECRET = "mock_only";
const originalFetch = globalThis.fetch;
let sequence = 0;
async function booking(gateway: "stripe" | "razorpay" = "stripe", overrides: Record<string, unknown> = {}) {
  const id = `refundtest${++sequence}`;
  const paymentId = `${gateway === "stripe" ? "pi" : "pay"}_${sequence}`;
  await saveBooking({ id,userId: "refund-owner",items: [],total: 549,subtotal: 549,discount: 0,visitFee: 0,name: "Refund Test",phone: "9000000000",address: "Test",date: "2030-01-01",slot: "10:00",payment: "online",status: "cancelled",paymentStatus: "paid",paymentProvider: gateway,createdAt: new Date().toISOString(),...(gateway === "stripe" ? { stripePaymentIntentId: paymentId } : { razorpayPaymentId: paymentId }),...overrides });
  return { id, paymentId };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("refund lifecycle uses mock providers only", async (t) => {
  const fixture=await mongoFixture("refunds");
  await fixture.seedUser("refund-owner","refund@example.invalid");
  try {
    await t.test("concurrent Stripe requests produce one exact full refund", async () => {
      const b = await booking();
      let posts = 0;
      globalThis.fetch = async (url, options) => {
        assert.ok(String(url).startsWith("https://api.stripe.com/v1/refunds"));
        if (options?.method !== "POST") return json({ data: [] });
        posts++;
        const body = new URLSearchParams(String(options.body));
        assert.equal(body.get("amount"), "54900");
        assert.equal(body.get("payment_intent"), b.paymentId);
        assert.match(new Headers(options.headers).get("Idempotency-Key")!, /^refund_[a-f0-9]{32}$/);
        return json({ id: "re_one", payment_intent: b.paymentId, amount: 54900, currency: "inr", status: "succeeded" });
      };
      await Promise.all(Array.from({ length: 10 }, () => requestBookingRefund(b.id)));
      assert.equal(posts, 1);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refunded");
      await requestBookingRefund(b.id);
      assert.equal(posts, 1);
    });
    await t.test("Razorpay remains pending until authenticated reconciliation", async () => {
      const b = await booking("razorpay");
      globalThis.fetch = async (url, options) => {
        if (String(url).includes("refunds?")) return json({ items: [] });
        if (options?.method === "POST") {
          assert.match(new Headers(options.headers).get("X-Refund-Idempotency")!, /^refund_[a-f0-9]{32}$/);
          assert.equal(JSON.parse(String(options.body)).amount, 54900);
          return json({ id: "rfnd_two", payment_id: b.paymentId, amount: 54900, currency: "INR", status: "pending" });
        }
        return json({ id: "rfnd_two", payment_id: b.paymentId, amount: 54900, currency: "INR", status: "processed" });
      };
      await requestBookingRefund(b.id);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refund_pending");
      await reconcileProviderRefund("razorpay", "rfnd_two");
      assert.equal((await getBooking(b.id))?.paymentStatus, "refunded");
    });
    await t.test("lost response is recovered without another POST", async () => {
      const b = await booking();
      let posts = 0;
      const refund = { id: "re_lost", payment_intent: b.paymentId, amount: 54900, currency: "inr", status: "succeeded" };
      globalThis.fetch = async (_url, options) => {
        if (options?.method === "POST") { posts++; throw new Error("Simulated response loss"); }
        return json({ data: posts ? [refund] : [] });
      };
      await requestBookingRefund(b.id);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refund_pending");
      await fixture.refunds.updateOne({booking_id:b.id},{$set:{next_attempt_at:"2000-01-01T00:00:00.000Z"}});
      await processPendingRefunds();
      assert.equal(posts, 1);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refunded");
    });
    await t.test("maintenance discovers missing queue after cancellation commit", async () => {
      const b = await booking();
      globalThis.fetch = async (_url, options) => options?.method === "POST" ? json({ id: "re_discovered", payment_intent: b.paymentId, amount: 54900, currency: "inr", status: "succeeded" }) : json({ data: [] });
      const result = await processPendingRefunds();
      assert.equal(result.discovered, 1);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refunded");
    });
    await t.test("cash and active appointments cannot trigger refunds", async () => {
      const cash = await booking("stripe", { payment: "cash" });
      const active = await booking("stripe", { status: "confirmed" });
      globalThis.fetch = async () => { throw new Error("Provider must not be called"); };
      await requestBookingRefund(cash.id);
      await requestBookingRefund(active.id);
      assert.equal(await fixture.refunds.countDocuments({booking_id:{$in:[cash.id,active.id]}}),0);
    });
    await t.test("definitive provider failure needs review and never re-POSTs", async () => {
      const b = await booking();
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        return options?.method === "POST" ? json({ id: "re_failed", payment_intent: b.paymentId, amount: 54900, currency: "inr", status: "failed" }) : json({ data: [] });
      };
      await requestBookingRefund(b.id);
      assert.equal((await getBooking(b.id))?.refundStatus, "failed");
      assert.equal((await getBooking(b.id))?.paymentStatus, "refund_pending");
      const before = calls;
      await requestBookingRefund(b.id);
      await processPendingRefunds();
      assert.equal(calls, before);
    });
    await t.test("mismatched provider amount never marks money refunded", async () => {
      const b = await booking();
      globalThis.fetch = async (_url, options) => options?.method === "POST" ? json({ id: "re_wrong", payment_intent: b.paymentId, amount: 100, currency: "inr", status: "succeeded" }) : json({ data: [] });
      await requestBookingRefund(b.id);
      assert.equal((await getBooking(b.id))?.paymentStatus, "refund_pending");
      assert.equal((await getBooking(b.id))?.refundStatus, "pending");
    });
    await t.test("crashed processing lease can be recovered", async () => {
      const b = await booking();
      globalThis.fetch = async () => { throw new Error("Offline"); };
      await requestBookingRefund(b.id);
      await fixture.refunds.updateOne({booking_id:b.id},{$set:{status:"processing",updated_at:"2000-01-01T00:00:00.000Z"}});
      globalThis.fetch = async (_url, options) => options?.method === "POST" ? json({ id: "re_recovered", payment_intent: b.paymentId, amount: 54900, currency: "inr", status: "succeeded" }) : json({ data: [] });
      await processPendingRefunds();
      assert.equal((await getBooking(b.id))?.paymentStatus, "refunded");
    });
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});
