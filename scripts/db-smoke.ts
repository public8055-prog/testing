import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mongoFixture } from "../tests/helpers/mongo-fixture";
import { getBooking, initDb, readBookings } from "../lib/db";
import { services } from "../lib/data";
import { cleanupExpiredRecords, expirePendingBookings } from "../lib/maintenance";
import { createCatalogBooking, cancelCatalogBooking } from "../lib/catalog-bookings";
import { indiaDate } from "../lib/booking-rules";
import { mongoCollection, withMongoTransaction } from "../lib/mongo";

async function main() {
  const fixture = await mongoFixture("dbsmoke");
  const slots = await mongoCollection("slot_inventory"), tokens = await mongoCollection("service_tokens");
  try {
    await Promise.all(Array.from({ length: 12 }, () => initDb()));
    assert.equal(await fixture.db.collection("services").countDocuments(), services.length);
    const customers = Array.from({ length: 60 }, () => randomUUID());
    await Promise.all(customers.map(id => fixture.seedUser(id)));
    const input = { items: [{ slug: "bathroom-deep-cleaning", qty: 1 }], name: "QA Customer", phone: "9876543210", address: "Apartment 10, New Delhi 110001", date: indiaDate(5), slot: "11:00 AM" as const, payment: "cash" as const, expectedTotal: 543 };
    const keys = customers.map(() => randomUUID());
    // Use complete domain transactions, not a synthetic update, to stress reservation safety.
    const reservations = await Promise.allSettled(customers.map((id, i) => createCatalogBooking(id, input, keys[i])));
    const winners = reservations.flatMap((result, index) => result.status === "fulfilled" ? [{ index, result: result.value }] : []);
    const rejected = reservations.filter(result => result.status === "rejected");
    for (const result of rejected) if (result.status === "rejected") assert.match(String(result.reason), /unavailable|full/);
    assert.equal(winners.length, 25); assert.equal(rejected.length, 35);
    assert.equal((await slots.findOne({ date: input.date, slot: input.slot }))?.reserved, 25);
    assert.equal(await fixture.bookings.countDocuments(), 25); assert.equal(await tokens.countDocuments(), 25);
    const winner = winners[0], id = winner.result.booking.id, userId = customers[winner.index];
    assert.equal((await readBookings(userId)).length, 1); assert.equal(await getBooking(id, "another-user"), null);
    const duplicate = await fixture.bookings.findOne({ id }); assert.ok(duplicate);
    await assert.rejects(() => fixture.bookings.insertOne(duplicate), /duplicate key/);
    const replay = await createCatalogBooking(userId, input, keys[winner.index]);
    assert.equal(replay.replayed, true); assert.equal(replay.booking.id, id);
    await assert.rejects(() => createCatalogBooking(userId, { ...input, name: "Different Customer" }, keys[winner.index]), /different booking details/);
    assert.equal(await tokens.countDocuments(), 25);
    await assert.rejects(() => withMongoTransaction(async session => {
      await slots.updateOne({ date: input.date, slot: input.slot }, { $set: { reserved: 0 } }, { session });
      throw new Error("Expected rollback");
    }), /Expected rollback/);
    assert.equal((await slots.findOne({ date: input.date, slot: input.slot }))?.reserved, 25);
    await Promise.all([cancelCatalogBooking(id, userId), cancelCatalogBooking(id, userId)]);
    assert.equal((await slots.findOne({ date: input.date, slot: input.slot }))?.reserved, 24);
    assert.equal(await fixture.db.collection("booking_events").countDocuments({ booking_id: id, type: "cancelled" }), 1);
    const loserIndex = reservations.findIndex(result => result.status === "rejected");
    await createCatalogBooking(customers[loserIndex], input, randomUUID());
    assert.equal((await slots.findOne({ date: input.date, slot: input.slot }))?.reserved, 25);

    const pending = await createCatalogBooking(userId, { ...input, date: indiaDate(6), payment: "card" }, randomUUID());
    await fixture.bookings.updateOne({ id: pending.booking.id }, { $set: { created_at: new Date(Date.now() - 40 * 60000).toISOString(), razorpay_order_id: "claim_active", updated_at: new Date().toISOString() } });
    assert.equal(await expirePendingBookings(), 0, "An active payment creation claim is protected");
    await fixture.bookings.updateOne({ id: pending.booking.id }, { $set: { razorpay_order_id: null } });
    const expirations = await Promise.all([expirePendingBookings(), expirePendingBookings()]);
    assert.equal(expirations.reduce((total, count) => total + count, 0), 1);
    assert.equal((await getBooking(pending.booking.id))?.status, "cancelled");
    assert.equal((await slots.findOne({ date: indiaDate(6), slot: input.slot }))?.reserved, 0, "Expiry releases capacity exactly once");
    await (await mongoCollection("sessions")).insertOne({ _id: "expired-session", token_hash: "expired-session", user_id: userId, expires_at: "2000-01-01T00:00:00.000Z" });
    assert.deepEqual(await cleanupExpiredRecords(), { sessions: 1, rateLimits: 0 });
    console.log("PASS: Mongo initialization, owner isolation, unique records, 60 distinct concurrent customers / 25 reservations, atomic tokens, idempotency, transaction rollback, single release, payment claim protection and concurrent expiry.");
  } finally { await fixture.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
