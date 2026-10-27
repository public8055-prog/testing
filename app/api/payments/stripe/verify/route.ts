import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { verifyStripeCheckout } from "@/lib/stripe-payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser(); await rateLimit(`stripe-verify:${user.id}`, 20, 60_000);
    const input = z.object({ bookingId: z.string().min(1).max(100), sessionId: z.string().regex(/^cs_(test_|live_)?[A-Za-z0-9]+$/).max(255) }).strict().safeParse(await readJson(request));
    if (!input.success) throw new HttpError(400, "Valid Stripe checkout details are required.");
    return Response.json(await verifyStripeCheckout(input.data.bookingId, input.data.sessionId, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
