import { createHash, randomUUID } from "node:crypto";
import type { ClientSession, Document } from "mongodb";
import { getMongoDb } from "./mongo";
export function authIdentityHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export async function auditAuthEvent(event: string, data: { userId?: string; identity?: string; ip?: string; familyId?: string; reason?: string } = {}, session?: ClientSession) {
  const id = randomUUID(), db = await getMongoDb();
  await db.collection<Document & { _id: string }>("auth_events").insertOne({ _id: id, id, event, user_id: data.userId || null, identity_hash: data.identity ? authIdentityHash(data.identity) : null, ip_hash: data.ip ? authIdentityHash(data.ip) : null, family_id: data.familyId || null, reason: data.reason || null, created_at: new Date().toISOString() }, { session });
}
