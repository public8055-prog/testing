import { requireAdmin } from "@/lib/auth";
import { bookingDocuments, mapBooking } from "@/lib/db";
import { mongoCollection } from "@/lib/mongo";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    await requireAdmin();
    const [rows, counts] = await Promise.all([bookingDocuments({}, 100), (await mongoCollection("bookings")).aggregate([
      { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ["$status", ["pending", "confirmed", "in_progress"]] }, 1, 0] } }, collected: { $sum: { $cond: [{ $eq: ["$payment_status", "paid"] }, "$total", 0] } }, refunds: { $sum: { $cond: [{ $eq: ["$payment_status", "refund_pending"] }, 1, 0] } } } }, { $unset: "_id" },
    ]).toArray()]);
    return Response.json({ bookings: rows.map(mapBooking), metrics: counts[0] || { total: 0, active: 0, collected: 0, refunds: 0 } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
