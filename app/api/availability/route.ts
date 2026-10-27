import { apiError, HttpError } from "@/lib/http";
import { indiaDate, SLOTS, slotTimestamp } from "@/lib/booking-rules";
import { initDb } from "@/lib/db";
import { mongoCollection } from "@/lib/mongo";
export async function GET(req: Request) {
  try {
    const date = new URL(req.url).searchParams.get("date") || indiaDate(1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < indiaDate() || date > indiaDate(30)) throw new HttpError(400, "Choose a date within the next 30 days.");
    await initDb(); const rows = await (await mongoCollection("slot_inventory")).find({ date }).toArray();
    return Response.json({ date, slots: SLOTS.map(slot => { const row = rows.find(r => r.slot === slot); const remaining = row ? Math.max(0, row.capacity - row.reserved) : 25; return { slot, available: remaining > 0 && slotTimestamp(date, slot) > Date.now() + 3600000, remaining }; }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
