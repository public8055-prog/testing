import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { createPaymentCheckout } from "@/lib/payment-router";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    await rateLimit(`checkout-provider:${user.id}`, 12, 60_000);
    const input = z.object({ bookingId: z.string().min(1).max(100) }).strict().safeParse(await readJson(request));
    if (!input.success) throw new HttpError(400, "A valid booking ID is required.");
    return Response.json(await createPaymentCheckout(input.data.bookingId, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
