import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { ensureOperations, issueServiceToken, updateTrackedStatus } from "@/lib/service-operations";
export const runtime = "nodejs";
const schema = z.object({ status: z.enum(["in_progress", "completed", "cancelled"]) }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); await rateLimit(`admin-bookings:${admin.id}`, 100, 60000);
    const input = schema.safeParse(await readJson(request));
    if (!input.success) throw new HttpError(400, "Choose a valid booking status.");
    const { id } = await context.params;
    const booking = await getBooking(id);
    if (!booking?.userId) throw new HttpError(404, "Booking not found.");
    await ensureOperations();
    const token = await issueServiceToken("catalog", id, booking.userId, booking.createdAt);
    await updateTrackedStatus(admin, token._id, input.data.status);
    return Response.json({ booking: await getBooking(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
