import { apiError, HttpError } from "@/lib/http";
import { processStripeWebhook } from "@/lib/stripe-payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 262144) throw new HttpError(413, "Webhook payload is too large.");
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Webhook body is required.");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 262144) { await reader.cancel(); throw new HttpError(413, "Webhook payload is too large."); } chunks.push(value); }
    return Response.json(await processStripeWebhook(Buffer.concat(chunks).toString("utf8"), request.headers.get("stripe-signature") || ""));
  } catch (error) { return apiError(error); }
}
