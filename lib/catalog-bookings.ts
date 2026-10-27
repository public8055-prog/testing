import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ClientSession } from "mongodb";
import { addBookingEvent, getBooking, initDb, mapBooking, parsePayload } from "./db";
import { mongoCollection, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { checkoutSchema, slotTimestamp } from "./booking-rules";
import { quoteServices } from "./quote";
import { ensureOperations, issueServiceToken } from "./service-operations";
import { prepareQueueNumber } from "./queue-numbering";
import { withDistributedLock } from "./redis";
import { syncQueueBookingStatus,publishQueueBooking } from "./queue-state";
import { isAccountActive } from "./roles";

export async function ensureCatalogSlot(date: string, slot: string) {
  const inventory = await mongoCollection("slot_inventory");
  try { await inventory.updateOne({ date, slot }, { $setOnInsert: { _id: `${date}|${slot}`, date, slot, reserved: 0, capacity: 25 } }, { upsert: true }); }
  catch (error) {
    // Two first-time callers can race to create the same unique slot document.
    // Accept only a proven winner for this exact slot; reservation itself is still transactional.
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000 && await inventory.findOne({ date, slot }))) throw error;
  }
}
export async function createCatalogBooking(userId: string, data: z.infer<typeof checkoutSchema>, key: string) {
  await initDb();
  await ensureOperations();
  const payloadHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const id=`BK-${randomUUID()}`,now=new Date().toISOString(),serviceIds=data.items.map(item=>item.slug).sort();
  const queue=await prepareQueueNumber("catalog",id,`catalog:${serviceIds.join("+")}`,data.date);
  await ensureCatalogSlot(data.date, data.slot);
  const result=await withDistributedLock(`catalog-booking:${userId}:${key}`,async assertOwned=>withMongoTransaction(async session => {
    const owner = await (await mongoCollection("users")).findOneAndUpdate({ id: userId }, { $inc: { booking_version: 1 } }, { session });
    if (!owner) throw new HttpError(401, "Please sign in again.");
    if (!isAccountActive(owner, await (await mongoCollection("platform_account_status")).findOne({ user_id: userId }, { session }))) throw new HttpError(403, "This account is unavailable.");
    const bookings = await mongoCollection("bookings");
    const existing = await bookings.findOne({ user_id: userId, idempotency_key: key }, { session });
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new HttpError(409, "This request key was already used for different booking details.");
      return { booking: mapBooking(existing), replayed: true };
    }
    await (await mongoCollection("app_locks")).updateOne({ _id: "catalog" }, { $inc: { version: 1 } }, { session });
    // Read authoritative prices/policies after acquiring the same lock used by catalog editors.
    const quote = await quoteServices(data.items, data.date, session);
    if (data.expectedTotal !== undefined && data.expectedTotal !== quote.total) throw new HttpError(409, "The service price changed. Refresh checkout and review the updated total.");
    if (!quote.slots.some(s => s.slot === data.slot && s.available)) throw new HttpError(409, "This time is unavailable or too late for your services. Choose an earlier slot.");
    const reserved = await (await mongoCollection("slot_inventory")).findOneAndUpdate({ date: data.date, slot: data.slot, $expr: { $lt: ["$reserved", "$capacity"] } }, { $inc: { reserved: 1 } }, { session });
    if (!reserved) throw new HttpError(409, "This slot is full. Please select another time.");
    const row = { _id: id, id, user_id: userId, items: JSON.stringify(quote.items.map(i => ({ slug: i.slug, title: i.s.title, price: i.s.price, qty: i.qty, durationMin: i.s.durationMin }))), total: quote.total, subtotal: quote.subtotal, discount: quote.discount, visit_fee: quote.visitFee,
      name: data.name, phone: data.phone, address: data.address, date: data.date, slot: data.slot, payment: data.payment, status: data.payment === "cash" ? "confirmed" : "pending", payment_status: "unpaid", idempotency_key: key, payload_hash: payloadHash, created_at: now, updated_at: now };
    assertOwned();await bookings.insertOne(row, { session });
    await issueServiceToken("catalog", id, userId, now, session,{...queue,service_ids:serviceIds,assigned_user_id:null,assigned_provider_id:null,estimated_minutes:quote.items.reduce((sum,item)=>sum+item.s.durationMin*item.qty,0)});
    await addBookingEvent(id, "created", { userId }, session);
    assertOwned();return { booking: mapBooking(row), replayed: false };
  }),{ttlMs:30000,waitMs:5000});
  if(!result.replayed)await publishQueueBooking("catalog",result.booking.id);return result;
}
export async function cancelCatalogBooking(id: string, userId: string) {
  await initDb();
  await withMongoTransaction(async session => {
    const bookings = await mongoCollection("bookings");
    const booking = await bookings.findOne({ id, user_id: userId }, { session });
    if (!booking) throw new HttpError(404, "Booking not found.");
    if (booking.status === "cancelled") return;
    if (!["pending", "confirmed"].includes(booking.status)) throw new HttpError(409, "This booking can no longer be cancelled.");
    if (booking.status === "confirmed" && slotTimestamp(booking.date, booking.slot) < Date.now() + 7200000) throw new HttpError(409, "Online cancellation closes two hours before your slot.");
    const changed = await bookings.updateOne({ id, user_id: userId, status: booking.status }, { $set: { status: "cancelled", payment_status: booking.payment_status === "paid" ? "refund_pending" : booking.payment_status, updated_at: new Date().toISOString() } }, { session });
    if (!changed.modifiedCount) throw new HttpError(409, "Booking changed. Please refresh.");
    await (await mongoCollection("slot_inventory")).updateOne({ date: booking.date, slot: booking.slot, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }, { session });
    await addBookingEvent(id, "cancelled", { userId }, session);
    await syncQueueBookingStatus("catalog",id,"cancelled",userId,session);
  });
  await publishQueueBooking("catalog",id);
  return getBooking(id, userId);
}
export async function transitionCatalogBooking(id: string, next: string, actorId: string) {
  await initDb();
  await withMongoTransaction(async session => {await transitionCatalogBookingInSession(id,next,actorId,session);await syncQueueBookingStatus("catalog",id,next,actorId,session);});
  await publishQueueBooking("catalog",id);
  return getBooking(id);
}
/** Caller owns authorization and the transaction so related notifications can commit with the status. */
export async function transitionCatalogBookingInSession(id: string, next: string, actorId: string, session: ClientSession) {
    const bookings = await mongoCollection("bookings");
    const booking = await bookings.findOneAndUpdate({ id }, { $inc: { state_version: 1 } }, { session, returnDocument: "after" });
    if (!booking) throw new HttpError(404, "Booking not found.");
    if (booking.status === next) return;
    const allowed = next === "cancelled" ? ["pending", "confirmed"].includes(booking.status) : next === "confirmed" ? booking.status === "pending" && booking.payment === "cash" : next === "in_progress" ? booking.status === "confirmed" : next === "completed" && booking.status === "in_progress";
    if (!allowed) throw new HttpError(409, "This status transition is not allowed. Refresh the booking.");
    if (next !== "cancelled" && booking.payment !== "cash" && booking.payment_status !== "paid") throw new HttpError(409, "Online payment must be captured before service can start or finish.");
    if (next === "in_progress" && slotTimestamp(booking.date, booking.slot) > Date.now() + 30 * 60000) throw new HttpError(409, "Service can start 30 minutes before its scheduled time.");
    if (next === "completed") {
      const items = parsePayload<{ durationMin?: number; qty: number }[]>(booking.items);
      const duration = items.reduce((sum, item) => sum + (Number(item.durationMin) || 60) * item.qty, 0);
      if (Date.now() < slotTimestamp(booking.date, booking.slot) + duration * 60000) throw new HttpError(409, "Completion can be confirmed after the scheduled service ends.");
    }
    await bookings.updateOne({ id, status: booking.status }, { $set: { status: next, payment_status: next === "cancelled" && booking.payment_status === "paid" ? "refund_pending" : booking.payment_status, updated_at: new Date().toISOString() } }, { session });
    if (next === "cancelled") await (await mongoCollection("slot_inventory")).updateOne({ date: booking.date, slot: booking.slot, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }, { session });
    // Completion never invents a cash receipt. Collection is recorded separately and audited.
    await addBookingEvent(id, `admin_${next}`, { actorId, from: booking.status, to: next }, session);
}
