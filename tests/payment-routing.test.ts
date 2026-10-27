import test from "node:test";
import assert from "node:assert/strict";
import { selectPaymentGateway, paymentConfig } from "../lib/payment-router";

test("UPI stays with Razorpay while card honors configured preference and availability", () => {
  const both = { razorpay: true, stripe: true };
  assert.equal(selectPaymentGateway("upi", both, "stripe"), "razorpay");
  assert.equal(selectPaymentGateway("card", both), "razorpay");
  assert.equal(selectPaymentGateway("card", both, "stripe"), "stripe");
  assert.equal(selectPaymentGateway("card", { razorpay: false, stripe: true }), "stripe");
  assert.equal(selectPaymentGateway("card", { razorpay: true, stripe: false }, "stripe"), "razorpay");
  assert.throws(() => selectPaymentGateway("upi", { razorpay: false, stripe: true }), /UPI is currently unavailable/);
  assert.throws(() => selectPaymentGateway("cash", both), /Choose card or UPI/);
});

test("a pinned checkout cannot silently switch gateways after uncertainty", () => {
  assert.equal(selectPaymentGateway("card", { razorpay: true, stripe: true }, "razorpay", "stripe"), "stripe");
  assert.throws(() => selectPaymentGateway("card", { razorpay: true, stripe: false }, "razorpay", "stripe"), /temporarily unavailable/);
  assert.throws(() => selectPaymentGateway("card", { razorpay: false, stripe: true }, "stripe", "razorpay"), /temporarily unavailable/);
});

test("public configuration reports method support without exposing secret keys", () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.STRIPE_SECRET_KEY = "sk_test_configurationonly";
  delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
  const config = paymentConfig();
  assert.deepEqual(config.methods, { upi: false, card: true });
  assert.equal(config.preferredGateway, "stripe");
  assert.equal(config.testMode, true);
  assert.equal(JSON.stringify(config).includes("configurationonly"), false);
});
