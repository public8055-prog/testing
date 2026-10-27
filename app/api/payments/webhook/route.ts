import { apiError, HttpError } from "@/lib/http";
import { processPaymentWebhook } from "@/lib/payments";

export const runtime = "nodejs";

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Webhook body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 262144) { await reader.cancel(); throw new HttpError(413, "Webhook payload is too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request) {
  try {
    // Signature verification must use the untouched request body, never re-serialized JSON.
    if (Number(request.headers.get("content-length") || 0) > 262144) throw new HttpError(413, "Webhook payload is too large.");
    const raw = await boundedBody(request);
    const result = await processPaymentWebhook(raw, request.headers.get("x-razorpay-signature") ?? "", request.headers.get("x-razorpay-event-id"));
    return Response.json(result);
  } catch (error) { return apiError(error); }
}
