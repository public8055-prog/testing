import { addBookingEvent, initDb } from "./db";
import { mongoCollection, withMongoTransaction } from "./mongo";
import { syncQueueBookingStatus, publishQueueBooking } from "./queue-state";
/** Bounded, atomic expiration: a late captured payment can only enter refund processing. */
export async function expirePendingBookings(): Promise<number> {
  await initDb();
  const now = new Date().toISOString(), cutoff = new Date(Date.now() - 30 * 60000).toISOString(), staleClaim = new Date(Date.now() - 60000).toISOString();
  const eligible = { status: "pending", payment_status: "unpaid", created_at: { $lt: cutoff }, $or: [{ razorpay_order_id: null }, { razorpay_order_id: { $not: /^claim_/ } }, { updated_at: { $lt: staleClaim } }] };
  const bookings = await mongoCollection("bookings");
  const candidates = await bookings.find(eligible, { projection: { id: 1 } }).sort({ created_at: 1 }).limit(200).toArray();
  let expired = 0;
  for (const candidate of candidates) {
    const changed = await withMongoTransaction(async session => {
      const booking = await bookings.findOneAndUpdate({ ...eligible, id: candidate.id }, { $set: { status: "cancelled", updated_at: now } }, { session });
      if (!booking) return false;
      await (await mongoCollection("slot_inventory")).updateOne({ date: booking.date, slot: booking.slot, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }, { session });
      await addBookingEvent(booking.id, "booking.expired", { reason: "Payment not received within 30 minutes" }, session);
      await syncQueueBookingStatus("catalog", booking.id, "cancelled", "maintenance", session);
      return true;
    });
    if (changed) { expired++; await publishQueueBooking("catalog", candidate.id); }
  }
  return expired;
}
export async function cleanupExpiredRecords(): Promise<{ sessions: number; rateLimits: number }> {
  const sessions = await mongoCollection("sessions");
  const expired = await sessions.find({ expires_at: { $lt: new Date().toISOString() } }, { projection: { _id: 1 } }).limit(1000).toArray();
  const removed = await sessions.deleteMany({ _id: { $in: expired.map(row => row._id) } });
  // Redis automatically expires rate-limit windows. Retain the legacy return contract.
  return { sessions: removed.deletedCount, rateLimits: 0 };
}
