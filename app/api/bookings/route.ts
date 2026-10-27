import { requireUser } from "@/lib/auth";
import { readBookings } from "@/lib/db";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { checkoutSchema } from "@/lib/booking-rules";
import { createCatalogBooking } from "@/lib/catalog-bookings";
import { paymentConfig } from "@/lib/payment-router";
export async function GET(req: Request) {
  try { const user = await requireUser(); const offset = Math.min(10000, Math.max(0, Number(new URL(req.url).searchParams.get("offset")) || 0)); return Response.json({ bookings: await readBookings(user.id, 20, offset) }, { headers: { "Cache-Control": "no-store" } }); } catch (e) { return apiError(e); }
}
export async function POST(req: Request) {
  try {
    assertSameOrigin(req); const user = await requireUser(); if (Number(user.email_verified) === 0) throw new HttpError(403, "Please verify your email before booking. Enter the 6-digit code we emailed you, or request a new one with email sign-in."); await rateLimit(`book:${user.id}`, 20, 60000);
    const parsed = checkoutSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid booking details.");
    const key = req.headers.get("idempotency-key");
    if (!key || !/^[\w-]{16,100}$/.test(key)) throw new HttpError(400, "A valid idempotency key is required.");
    if (parsed.data.payment !== "cash" && !paymentConfig().methods[parsed.data.payment]) throw new HttpError(503, "This online payment method is unavailable. Select another method or pay after service.");
    const result = await createCatalogBooking(user.id, parsed.data, key);
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (e) { return apiError(e); }
}
