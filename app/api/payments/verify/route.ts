import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson, HttpError } from "@/lib/http";
import { verifyCheckoutPayment } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({
  bookingId: z.string().min(1).max(100),
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/).max(100),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/).max(100),
  razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`payment-verify:${user.id}`, 20, 60_000);
    const input = schema.safeParse(await readJson(request));
    if (!input.success) throw new HttpError(400, "Payment verification details are invalid.");
    return Response.json(await verifyCheckoutPayment(input.data, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
