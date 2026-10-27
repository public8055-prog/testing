import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mongoFixture } from "./helpers/mongo-fixture";
import { createStripeCheckout, verifyStripeCheckout, processStripeWebhook, verifyStripeWebhookSignature } from "../lib/stripe-payments";
import { createPaymentCheckout } from "../lib/payment-router";

test("Stripe HMAC verification rejects stale, future, tampered and malformed signatures", () => {
  const raw = '{"id":"evt_test"}'; const secret = "whsec_test"; const now = 1700000000;
  const sig = createHmac("sha256", secret).update(`${now}.${raw}`).digest("hex");
  assert.equal(verifyStripeWebhookSignature(raw, `t=${now},v1=${sig}`, secret, now), true);
  assert.equal(verifyStripeWebhookSignature(raw, `t=${now},v1=bad,v1=${sig}`, secret, now), true);
  assert.equal(verifyStripeWebhookSignature(raw, `t=${now},v1=${sig}`, secret, now + 301), false);
  assert.equal(verifyStripeWebhookSignature(raw, `t=${now},v1=${sig}`, secret, now - 301), false);
  assert.equal(verifyStripeWebhookSignature(raw + " ", `t=${now},v1=${sig}`, secret, now), false);
  assert.equal(verifyStripeWebhookSignature(raw, `t=${now},t=${now},v1=${sig}`, secret, now), false);
});

test("Stripe checkout uses server amount, pinned retries, ownership and captured verification with automatic late refund", async () => {
  const fixture=await mongoFixture("stripe");
  process.env.APP_URL = "http://localhost:3001";
  process.env.STRIPE_SECRET_KEY = "sk_test_isolatedmock";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_isolatedmock";
  delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
  const originalFetch = globalThis.fetch;
  const now = new Date().toISOString();
  const requests: { url: string; body: string; key: string | null }[] = [];
  let captured = false; let incorrectAmount = false; let timeout = false;
  const session = (id: string, booking: string) => ({ id, mode: "payment", url: `https://checkout.stripe.com/c/pay/${id}`, status: captured ? "complete" : "open", payment_status: captured ? "paid" : "unpaid", amount_total: incorrectAmount ? 1 : 10000, currency: "inr", livemode: false, client_reference_id: booking, metadata: { booking_id: booking }, payment_intent: captured ? { id: `pi_${booking}`, status: "succeeded", amount: 10000, amount_received: 10000, currency: "inr", metadata: { booking_id: booking } } : null });
  globalThis.fetch = async (input, init) => {
    const url = String(input); const body = String(init?.body || ""); const headers = new Headers(init?.headers);
    requests.push({ url, body, key: headers.get("Idempotency-Key") });
    if (!url.startsWith("https://api.stripe.com/")) throw new Error(`Unexpected network URL: ${url}`);
    if (timeout) throw new Error("simulated uncertain timeout");
    if (url.includes("/refunds?")) return Response.json({ data: [] });
    if (url.endsWith("/refunds")) { const params = new URLSearchParams(body); return Response.json({ id: "re_late", payment_intent: params.get("payment_intent"), amount: Number(params.get("amount")), currency: "inr", status: "succeeded" }); }
    if (url.endsWith("/checkout/sessions")) { const booking = new URLSearchParams(body).get("client_reference_id")!; return Response.json(session(`cs_test_${booking}`, booking)); }
    const id = new URL(url).pathname.split("/").pop()!;
    return Response.json(session(id, id.replace("cs_test_", "")));
  };
  try {
    await fixture.seedUser("stripeuser","stripe@example.test");
    for(const id of ["normal","late","uncertain"])await fixture.seedBooking(id,"stripeuser",{created_at:now,updated_at:now});
    const first = await createPaymentCheckout("normal", "stripeuser");
    assert.equal(first.gateway, "stripe");
    const sent = new URLSearchParams(requests[0].body);
    assert.equal(sent.get("line_items[0][price_data][unit_amount]"), "10000");
    assert.equal(sent.get("line_items[0][price_data][currency]"), "inr");
    assert.equal(sent.get("success_url"), "http://localhost:3001/bookings/normal?stripe_session_id={CHECKOUT_SESSION_ID}");
    assert.equal(requests[0].key, "urbankare-checkout-normal-v1");
    await createStripeCheckout("normal", "stripeuser");
    assert.equal(requests.filter((r) => r.url.endsWith("/checkout/sessions")).length, 1);
    await assert.rejects(verifyStripeCheckout("normal", "cs_test_normal", "other-user"), /Booking not found/);
    await assert.rejects(verifyStripeCheckout("normal", "cs_test_other", "stripeuser"), /does not match/);
    await assert.rejects(verifyStripeCheckout("normal", "cs_test_normal", "stripeuser"), /awaiting captured-payment/);
    captured = true; incorrectAmount = true;
    await assert.rejects(verifyStripeCheckout("normal", "cs_test_normal", "stripeuser"), /do not match/);
    incorrectAmount = false;
    assert.equal((await verifyStripeCheckout("normal", "cs_test_normal", "stripeuser")).paymentStatus, "paid");
    await Promise.all(Array.from({length:6},()=>verifyStripeCheckout("normal","cs_test_normal","stripeuser")));
    assert.equal(await fixture.paymentEvents.countDocuments(),1);
    captured = false; await createStripeCheckout("late", "stripeuser");
    await fixture.bookings.updateOne({id:"late"},{$set:{status:"cancelled"}});captured=true;
    const raw = JSON.stringify({ id: "evt_late", type: "checkout.session.completed", data: { object: { id: "cs_test_late" } } });
    const timestamp = Math.floor(Date.now() / 1000); const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest("hex");
    await processStripeWebhook(raw, `t=${timestamp},v1=${signature}`);
    await processStripeWebhook(raw, `t=${timestamp},v1=${signature}`);
    const late=await fixture.bookings.findOne({id:"late"},{projection:{_id:0,status:1,payment_status:1}});
    assert.deepEqual({ ...late }, { status: "cancelled", payment_status: "refunded" });
    assert.equal(requests.filter((r) => r.url.endsWith("/refunds")).length, 1);
    captured = false; timeout = true;
    await assert.rejects(createStripeCheckout("uncertain", "stripeuser"), /could not be reached/);
    assert.equal((await fixture.bookings.findOne({id:"uncertain"}))?.payment_provider,"stripe");
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock"; process.env.RAZORPAY_KEY_SECRET = "mock"; delete process.env.STRIPE_SECRET_KEY;
    const count = requests.length;
    await assert.rejects(createPaymentCheckout("uncertain", "stripeuser"), /temporarily unavailable/);
    assert.equal(requests.length, count);
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});
