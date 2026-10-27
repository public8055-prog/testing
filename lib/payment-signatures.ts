import { createHmac, timingSafeEqual } from "node:crypto";

/** Only accepts a full SHA-256 hex digest; malformed signatures never reach comparison. */
export function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  return verifyHmacSignature(`${orderId}|${paymentId}`, signature, secret);
}
