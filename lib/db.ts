import { randomUUID } from "node:crypto";
import type { ClientSession, Document, Filter } from "mongodb";
import { services } from "./data";
import type { Booking, Category, Professional, Service } from "./types";
import { closeMongo, getMongoDb, mongoCollection, withMongoTransaction } from "./mongo";
import { cachedJson, closeRedis } from "./redis";
import {isBuiltinCatalog} from "./runtime-config.mjs";
import {builtinCategories,builtinService,builtinServices} from "./builtin-catalog";

let initialized: Promise<void> | undefined;
export function databaseDriver() { return "mongodb" as const; }
export function parsePayload<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
export const activeCatalogFilter = { active: { $ne: false }, archived: { $ne: true }, deleted: { $ne: true }, "payload.active": { $ne: false }, "payload.archived": { $ne: true }, "payload.deleted": { $ne: true } };

export async function initDb(): Promise<void> {
  if (!initialized) initialized = (async () => {
    const db = await getMongoDb();
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ id: 1 }, { unique: true });
    await db.collection("sessions").createIndex({ token_hash: 1 }, { unique: true });
    await db.collection("sessions").createIndex({ expires_at: 1 });
    await db.collection("sessions").createIndex({ user_id: 1 });
    await db.collection("categories").createIndex({ slug: 1 }, { unique: true });
    await db.collection("services").createIndex({ slug: 1 }, { unique: true });
    await db.collection("services").createIndex({ category: 1, archived: 1 });
    await db.collection("bookings").createIndex({ id: 1 }, { unique: true });
    await db.collection("bookings").createIndex({ user_id: 1, idempotency_key: 1 }, { unique: true, partialFilterExpression: { idempotency_key: { $type: "string" } } });
    for (const field of ["razorpay_order_id", "razorpay_payment_id", "stripe_session_id", "stripe_payment_intent_id"]) {
      await db.collection("bookings").createIndex({ [field]: 1 }, { unique: true, partialFilterExpression: { [field]: { $type: "string" } } });
    }
    await db.collection("bookings").createIndex({ user_id: 1, created_at: -1 });
    await db.collection("bookings").createIndex({ status: 1, date: 1 });
    await db.collection("slot_inventory").createIndex({ date: 1, slot: 1 }, { unique: true });
    await db.collection("booking_events").createIndex({ booking_id: 1, created_at: 1 });
    await db.collection("payment_events").createIndex({ id: 1 }, { unique: true });
    await db.collection("payment_refunds").createIndex({ booking_id: 1 }, { unique: true });
    await db.collection("payment_refunds").createIndex({ gateway: 1, provider_refund_id: 1 }, { unique: true, partialFilterExpression: { provider_refund_id: { $type: "string" } } });
    await db.collection("payment_refunds").createIndex({ status: 1, next_attempt_at: 1 });
    // The catalogue starts empty by design. Re-seed on demand with `npm run db:catalog`.
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}

export function mapBooking(row: Record<string, unknown>): Booking {
  return {
    id: String(row.id), userId: String(row.user_id), items: parsePayload<Booking["items"]>(row.items),
    total: Number(row.total), subtotal: Number(row.subtotal), discount: Number(row.discount), visitFee: Number(row.visit_fee),
    name: String(row.name), phone: String(row.phone), address: String(row.address), date: String(row.date), slot: String(row.slot),
    payment: String(row.payment), status: row.status as Booking["status"], paymentStatus: row.payment_status as Booking["paymentStatus"],
    razorpayOrderId: row.razorpay_order_id ? String(row.razorpay_order_id) : undefined,
    razorpayPaymentId: row.razorpay_payment_id ? String(row.razorpay_payment_id) : undefined,
    paymentProvider: row.payment_provider ? row.payment_provider as Booking["paymentProvider"] : undefined,
    stripeSessionId: row.stripe_session_id ? String(row.stripe_session_id) : undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ? String(row.stripe_payment_intent_id) : undefined,
    stripeCheckoutUrl: row.stripe_checkout_url ? String(row.stripe_checkout_url) : undefined,
    refundStatus: row.refund_status ? row.refund_status as Booking["refundStatus"] : undefined,
    refundMessage: row.refund_message ? String(row.refund_message) : undefined,
    refundId: row.refund_id ? String(row.refund_id) : undefined,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
export async function addBookingEvent(bookingId: string, type: string, payload: unknown, session?: ClientSession) {
  const id = randomUUID();
  await (await mongoCollection("booking_events")).insertOne({ _id: id, id, booking_id: bookingId, type, payload: JSON.stringify(payload), created_at: new Date().toISOString() }, { session });
}
export async function saveBooking(booking: Booking & { userId: string; idempotencyKey?: string; payloadHash?: string }): Promise<Booking> {
  await initDb();
  await withMongoTransaction(async session => {
    if (!await (await mongoCollection("users")).findOne({ id: booking.userId }, { session })) throw new Error("Booking owner does not exist.");
    await (await mongoCollection("bookings")).insertOne({
      _id: booking.id, id: booking.id, user_id: booking.userId, items: JSON.stringify(booking.items), total: booking.total, subtotal: booking.subtotal, discount: booking.discount, visit_fee: booking.visitFee,
      name: booking.name, phone: booking.phone, address: booking.address, date: booking.date, slot: booking.slot, payment: booking.payment, status: booking.status, payment_status: booking.paymentStatus || "unpaid",
      razorpay_order_id: booking.razorpayOrderId || null, razorpay_payment_id: booking.razorpayPaymentId || null, idempotency_key: booking.idempotencyKey || null, payload_hash: booking.payloadHash || null,
      payment_provider: booking.paymentProvider || null, stripe_session_id: booking.stripeSessionId || null, stripe_payment_intent_id: booking.stripePaymentIntentId || null, stripe_checkout_url: booking.stripeCheckoutUrl || null,
      created_at: booking.createdAt, updated_at: booking.updatedAt || booking.createdAt,
    }, { session });
    await addBookingEvent(booking.id, "booking.created", { status: booking.status }, session);
  });
  return booking;
}
export async function bookingDocuments(filter: Filter<Document> = {}, limit = 20, offset = 0) {
  await initDb();
  return (await mongoCollection("bookings")).aggregate([
    { $match: filter }, { $sort: { created_at: -1, _id: 1 } },
    { $skip: Math.max(0, Math.min(10000, Math.trunc(offset) || 0)) }, { $limit: Math.min(300, Math.max(1, Math.trunc(limit) || 20)) },
    { $lookup: { from: "payment_refunds", localField: "id", foreignField: "booking_id", as: "refund" } },
    { $set: { refund_status: { $arrayElemAt: ["$refund.status", 0] }, refund_message: { $arrayElemAt: ["$refund.last_error", 0] }, refund_id: { $arrayElemAt: ["$refund.provider_refund_id", 0] } } },
    { $unset: "refund" },
  ]).toArray();
}
export async function readBookings(userId: string, limit = 20, offset = 0): Promise<Booking[]> { return (await bookingDocuments({ user_id: userId }, Math.min(limit, 100), offset)).map(mapBooking); }
export async function getBooking(id: string, userId?: string): Promise<Booking | null> {
  const rows = await bookingDocuments({ id, ...(userId ? { user_id: userId } : {}) }, 1);
  return rows[0] ? mapBooking(rows[0]) : null;
}
export async function readCategories(): Promise<Category[]> {
  if(isBuiltinCatalog())return builtinCategories();
  await initDb();
  return cachedJson("categories", 30, async () => {
    const rows = await (await mongoCollection("categories")).aggregate([
      { $match: activeCatalogFilter }, { $sort: { position: 1, slug: 1 } },
      { $lookup: { from: "services", let: { slug: "$slug" }, pipeline: [{ $match: { ...activeCatalogFilter, $expr: { $eq: ["$category", "$$slug"] } } }, { $count: "count" }], as: "serviceCount" } },
    ]).toArray();
    return rows.map(row => ({ ...parsePayload<Category>(row.payload), servicesCount: Number(row.serviceCount[0]?.count || 0) }));
  });
}
export async function readServices(category?: string): Promise<Service[]> {
  if(isBuiltinCatalog())return builtinServices(category);
  await initDb();
  return cachedJson(`services:${category || "all"}`, 30, async () => {
    const active = await (await mongoCollection("categories")).find(activeCatalogFilter, { projection: { slug: 1 } }).toArray();
    const slugs = active.map(c => c.slug as string);
    if (category && !slugs.includes(category)) return [];
    const rows = await (await mongoCollection("services")).find({ ...activeCatalogFilter, category: category || { $in: slugs } }).sort({ slug: 1 }).toArray();
    return rows.map(row => ({ ...services.find(s => s.slug === row.slug), ...parsePayload<Service>(row.payload), price: Number(row.price) }));
  });
}
export async function getCatalogService(slug: string): Promise<Service | null> {
  if(isBuiltinCatalog())return builtinService(slug);
  await initDb();
  const row = await (await mongoCollection("services")).findOne({ slug, ...activeCatalogFilter });
  if (row && !await (await mongoCollection("categories")).findOne({ slug: row.category, ...activeCatalogFilter })) return null;
  return row ? { ...services.find(s => s.slug === slug), ...parsePayload<Service>(row.payload), price: Number(row.price) } : null;
}
export async function readProfessionals(): Promise<Professional[]> {
  if(isBuiltinCatalog())return [];
  await initDb();
  return (await (await mongoCollection("professionals")).find({}).sort({ id: 1 }).toArray()).map(row => parsePayload<Professional>(row.payload));
}
export async function closeDb() { initialized = undefined; await closeMongo(); await closeRedis(); }
