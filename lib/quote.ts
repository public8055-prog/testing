import type { ClientSession } from "mongodb";
import { activeCatalogFilter, initDb, parsePayload } from "@/lib/db";
import { mongoCollection } from "@/lib/mongo";
import { HttpError } from "@/lib/http";
import { indiaDate, isBookableSlot, SLOTS, totals, DEFAULT_CATALOG_PRICING } from "@/lib/booking-rules";
import { readPlatformConfig } from "@/lib/platform";
import type { Service } from "@/lib/types";
export type ServiceQuote = { items: { slug: string; qty: number; s: Service }[]; subtotal: number; discount: number; visitFee: number; total: number; durationMin: number; date: string; slots: { slot: string; available: boolean; remaining: number; reason: string | null }[] };

export async function assertCategoriesBookable(slugs: string[], session?: ClientSession) {
  const unique = [...new Set(slugs)];
  if (!unique.length) throw new HttpError(400, "Choose at least one service.");
  const count = await (await mongoCollection("categories")).countDocuments({ slug: { $in: unique }, ...activeCatalogFilter }, { session });
  if (count !== unique.length) throw new HttpError(409, "A service category is no longer accepting bookings. Remove that service from your cart.");
}
export async function quoteServices(items: { slug: string; qty: number }[], date = indiaDate(1), session?: ClientSession): Promise<ServiceQuote> {
  if (!session) await initDb();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < indiaDate() || date > indiaDate(30) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new HttpError(400, "Choose a valid date within the next 30 days.");
  const detailed: ServiceQuote["items"] = [];
  const collection = await mongoCollection("services");
  // Sequential operations are required inside a MongoDB transaction.
  for (const item of items) {
    const row = await collection.findOne({ slug: item.slug, ...activeCatalogFilter }, { session });
    if (!row) throw new HttpError(400, "A service is no longer available. Remove it from your cart.");
    detailed.push({ ...item, s: { ...parsePayload<Service>(row.payload), price: Number(row.price) } });
  }
  await assertCategoriesBookable(detailed.map(i => i.s.category), session);
  const durationMin = detailed.reduce((sum, i) => sum + i.s.durationMin * i.qty, 0);
  if (durationMin > 600) throw new HttpError(400, "This cart needs more than 10 hours. Please split these services into separate bookings.");
  const rows = await (await mongoCollection("slot_inventory")).find({ date }, { session }).toArray();
  const config: Record<string, string> = session
    ? Object.fromEntries((await (await mongoCollection("platform_config")).find({}, { session }).toArray()).map(row => [String(row.key), String(row.value)]))
    : await readPlatformConfig();
  const policy = { discountPercent: Number(config.catalog_discount_percent ?? DEFAULT_CATALOG_PRICING.discountPercent), visitFee: Number(config.catalog_visit_fee ?? DEFAULT_CATALOG_PRICING.visitFee), feeWaiverThreshold: Number(config.catalog_fee_waiver_threshold ?? DEFAULT_CATALOG_PRICING.feeWaiverThreshold) };
  if (!Number.isFinite(policy.discountPercent) || policy.discountPercent < 0 || policy.discountPercent > 100 || !Number.isInteger(policy.visitFee) || policy.visitFee < 0 || !Number.isInteger(policy.feeWaiverThreshold) || policy.feeWaiverThreshold < 0) throw new HttpError(503, "The booking pricing policy needs administrator review.");
  return { items: detailed, ...totals(detailed.map(i => ({ price: i.s.price, qty: i.qty })), policy), durationMin, date, slots: SLOTS.map(slot => {
    const row = rows.find(r => r.slot === slot), remaining = row ? Math.max(0, row.capacity - row.reserved) : 25, fits = isBookableSlot(date, slot, durationMin);
    return { slot, available: remaining > 0 && fits, remaining, reason: remaining === 0 ? "Fully booked" : !fits ? "Not enough time for this service" : null };
  }) };
}
