import { requireUser } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { rescheduleBooking } from "@/lib/reschedule";
import { cancelCatalogBooking } from "@/lib/catalog-bookings";
import { requestBookingRefund } from "@/lib/refunds";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  try { const user = await requireUser(); const booking = await getBooking((await ctx.params).id, user.id); if (!booking) throw new HttpError(404, "Booking not found."); return Response.json({ booking }, { headers: { "Cache-Control": "no-store" } }); } catch (e) { return apiError(e); }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    assertSameOrigin(req); const user = await requireUser(); await rateLimit(`booking-update:${user.id}`, 30, 60000);
    const { id } = await ctx.params, body = await readJson(req);
    if (body?.action === "reschedule") {
      if (typeof body.date !== "string" || typeof body.slot !== "string") throw new HttpError(400, "Choose a new date and time.");
      return Response.json({ booking: await rescheduleBooking(id, user.id, body.date, body.slot) });
    }
    if (body?.action !== "cancel") throw new HttpError(400, "Unsupported action.");
    await cancelCatalogBooking(id, user.id); await requestBookingRefund(id);
    return Response.json({ booking: await getBooking(id, user.id) });
  } catch (e) { return apiError(e); }
}
