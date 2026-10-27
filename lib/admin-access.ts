import type { ClientSession, Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { getMongoDb } from "./mongo";
import { HttpError } from "./http";
import { canonicalRole, isAccountActive, isAdminRole } from "./roles";

export type AdminActor = { id: string; role: string };
type Row = Document & { _id: string };

/** The persisted account, never a caller-supplied role, is the authority. */
export async function requirePersistedAdmin(actor: AdminActor, session?: ClientSession) {
  if (!isAdminRole(actor.role)) throw new HttpError(403, "Administrator access required.");
  const db = await getMongoDb();
  const user = await db.collection<Row>("users").findOne({ id: actor.id }, { session });
  const status = await db.collection<Row>("platform_account_status").findOne({ user_id: actor.id }, { session });
  if (!user || !isAdminRole(user.role) || !isAccountActive(user, status)) throw new HttpError(403, "Administrator access required.");
  return { ...user, role: canonicalRole(user.role) };
}

export async function recordAdminAudit(actor: AdminActor, action: string, target: string, details: unknown, session: ClientSession) {
  const id = randomUUID();
  await (await getMongoDb()).collection<Row>("platform_audit").insertOne({ _id: id, id, actor_id: actor.id, action, target_id: target, details: JSON.stringify(details), created_at: new Date().toISOString() }, { session });
}
