import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson, HttpError } from "@/lib/http";
import { createPaymentOrder } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({ bookingId: z.string().min(1).max(100) }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await rateLimit(`payment-orders:${user.id}`, 12, 60_000);
    const input = schema.safeParse(await readJson(request));
    if (!input.success) throw new HttpError(400, "A valid booking ID is required.");
    return Response.json(await createPaymentOrder(input.data.bookingId, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
