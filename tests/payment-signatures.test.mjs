import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyHmacSignature, verifyPaymentSignature } from "../lib/payment-signatures.ts";

const secret = "test-only-webhook-secret";
const sign = (payload) => createHmac("sha256", secret).update(payload).digest("hex");

test("checkout signature binds the server order to the exact payment", () => {
  const signature = sign("order_expected|pay_expected");
  assert.equal(verifyPaymentSignature("order_expected", "pay_expected", signature, secret), true);
  assert.equal(verifyPaymentSignature("order_other", "pay_expected", signature, secret), false);
  assert.equal(verifyPaymentSignature("order_expected", "pay_other", signature, secret), false);
  assert.equal(verifyPaymentSignature("order_expected", "pay_expected", signature, "wrong-secret"), false);
});

test("malformed signature inputs are rejected without throwing", () => {
  for (const signature of ["", "x".repeat(64), "a".repeat(63), "a".repeat(65), "00", "🚀".repeat(64)]) {
    assert.equal(verifyHmacSignature("payload", signature, secret), false);
  }
  assert.equal(verifyHmacSignature("payload", sign("payload"), ""), false);
});

test("webhook signatures are verified against unchanged raw bytes", () => {
  const raw = '{ "event": "payment.captured", "id": "one" }';
  const signature = sign(raw);
  assert.equal(verifyHmacSignature(raw, signature, secret), true);
  assert.equal(verifyHmacSignature(JSON.stringify(JSON.parse(raw)), signature, secret), false);
  assert.equal(verifyHmacSignature(raw.replace("one", "two"), signature, secret), false);
});
