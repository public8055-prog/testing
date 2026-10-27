import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mongoCollection, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
const inputSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.email().max(254), subject: z.string().trim().min(4).max(120), message: z.string().trim().min(15).max(3000), consent: z.literal(true), website: z.string().max(0).optional() }).strict();
export async function createContact(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Enter your name, email, a clear message, and agree to the privacy notice.");
  const collection = await mongoCollection("contact_requests");
  await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ created_at: -1 });
  const { name, email, subject, message } = parsed.data;
  const data = { name, email, subject, message };
  const id = randomUUID(), now = new Date();
  await collection.insertOne({ _id: id, ...data, email: data.email.toLowerCase(), reference: `UK-HELP-${id.slice(0, 8).toUpperCase()}`, status: "open", created_at: now.toISOString(), expires_at: new Date(now.getTime() + 90 * 86400000), privacy_version: "2026-10-25", consent_at: now.toISOString() });
  return { reference: `UK-HELP-${id.slice(0, 8).toUpperCase()}` };
}
export async function listContacts(page: number) {
  const collection = await mongoCollection("contact_requests");
  const current = Math.min(200, Math.max(1, Math.trunc(page) || 1));
  const [rows, total] = await Promise.all([collection.find({}, { projection: { expires_at: 0 } }).sort({ created_at: -1 }).skip((current - 1) * 30).limit(30).toArray(), collection.countDocuments()]);
  return { rows: rows.map(row => ({ id: row._id, name: String(row.name), email: String(row.email), subject: String(row.subject), message: String(row.message), reference: String(row.reference), status: String(row.status), createdAt: String(row.created_at) })), total, page: current, pages: Math.max(1, Math.ceil(total / 30)) };
}
export async function updateContact(actorId: string, input: unknown) {
  const parsed = z.object({ id: z.uuid(), status: z.enum(["open", "reviewing", "resolved"]) }).strict().safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Choose a valid request and status.");
  await withMongoTransaction(async session => {
    const actor = await (await mongoCollection("users")).findOneAndUpdate({ id: actorId, role: { $in: ["SUPER_ADMIN", "ADMIN", "admin"] } }, { $inc: { operations_version: 1 } }, { session });
    const state = await (await mongoCollection("platform_account_status")).findOne({ user_id: actorId }, { session });
    if (!actor || state && Number(state.active) !== 1) throw new HttpError(403, "Administrator access required.");
    const result = await (await mongoCollection("contact_requests")).updateOne({ _id: parsed.data.id }, { $set: { status: parsed.data.status, updated_at: new Date().toISOString() } }, { session });
    if (!result.matchedCount) throw new HttpError(404, "Contact request not found.");
    const id = randomUUID();
    await (await mongoCollection("platform_audit")).insertOne({ _id: id, id, actor_id: actorId, action: "contact.status", target_id: parsed.data.id, details: JSON.stringify({ status: parsed.data.status }), created_at: new Date().toISOString() }, { session });
  });
}
