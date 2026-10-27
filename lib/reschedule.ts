import { addBookingEvent, getBooking, getCatalogService, initDb } from "@/lib/db";
import { mongoCollection, withMongoTransaction } from "@/lib/mongo";
import { ensureCatalogSlot } from "@/lib/catalog-bookings";
import { HttpError } from "@/lib/http";
import { isBookableSlot, slotTimestamp } from "@/lib/booking-rules";
import { ensureOperations,issueServiceToken } from "@/lib/service-operations";
import { prepareQueueNumber,type QueueNumber } from "@/lib/queue-numbering";
import { rescheduleQueueInSession,publishQueueBooking } from "@/lib/queue-state";
import { isAccountActive } from "@/lib/roles";
export async function rescheduleBooking(id: string, userId: string, date: string, slot: string) {
  await initDb();
  const original = await getBooking(id, userId);
  if (!original) throw new HttpError(404, "Booking not found.");
  const durations = await Promise.all(original.items.map(async item => (item.durationMin ?? (await getCatalogService(item.slug))?.durationMin ?? 60) * item.qty));
  if (!isBookableSlot(date, slot, durations.reduce((a, b) => a + b, 0))) throw new HttpError(400, "Choose an available time at least one hour ahead, with enough time to finish by 9 PM.");
  await ensureOperations();
  const token=await issueServiceToken("catalog",id,userId,original.createdAt),serviceIds=original.items.map(item=>item.slug).sort(),serviceId=`catalog:${serviceIds.join("+")||"legacy"}`;
  const queue:QueueNumber=token.queue_day===date&&token.sequence?{service_id:serviceId,queue_day:date,sequence:token.sequence,token:token.token}:await prepareQueueNumber("catalog",`${id}:reschedule:${date}`,serviceId,date);
  await ensureCatalogSlot(date, slot);
  const previousQueue=await withMongoTransaction(async session => {
    const actor=await (await mongoCollection("users")).findOneAndUpdate({ id: userId }, { $inc: { booking_version: 1 } }, { session,returnDocument:"after" });
    if(!isAccountActive(actor,await(await mongoCollection("platform_account_status")).findOne({user_id:userId},{session})))throw new HttpError(403,"This account is unavailable.");
    const bookings = await mongoCollection("bookings");
    const booking = await bookings.findOne({ id, user_id: userId }, { session });
    if (!booking) throw new HttpError(404, "Booking not found.");
    if (!["pending", "confirmed"].includes(booking.status)) throw new HttpError(409, "This booking can no longer be rescheduled.");
    if (booking.status === "confirmed" && slotTimestamp(booking.date, booking.slot) < Date.now() + 7200000) throw new HttpError(409, "Rescheduling closes two hours before your visit.");
    if (date === booking.date && slot === booking.slot) return;
    const reserved = await (await mongoCollection("slot_inventory")).findOneAndUpdate({ date, slot, $expr: { $lt: ["$reserved", "$capacity"] } }, { $inc: { reserved: 1 } }, { session });
    if (!reserved) throw new HttpError(409, "That slot just filled up. Choose another time.");
    await bookings.updateOne({ id, user_id: userId, status: booking.status }, { $set: { date, slot, updated_at: new Date().toISOString() } }, { session });
    await (await mongoCollection("slot_inventory")).updateOne({ date: booking.date, slot: booking.slot, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }, { session });
    await addBookingEvent(id, "rescheduled", { from: { date: booking.date, slot: booking.slot }, to: { date, slot } }, session);
    return rescheduleQueueInSession(id,queue,serviceIds,userId,session);
  });
  await publishQueueBooking("catalog",id,previousQueue);
  return getBooking(id, userId);
}
