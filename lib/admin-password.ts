import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { z } from "zod";
import { ensureAuth } from "./auth";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { checkPassword, hashPassword } from "./password-hashing";
import { isAccountActive, isAdminRole } from "./roles";
import { HttpError } from "./http";
import { auditAuthEvent } from "./auth-audit";
import { clearLoginFailures, revokeUserRefreshFamilies } from "./auth-state";

type Row = Document & { _id: string };
export async function changeAdminPassword(userId: string, currentPassword: string, newPassword: string) {
  if (!z.string().min(1).max(128).safeParse(currentPassword).success || !z.string().min(10).max(128).safeParse(newPassword).success)
    throw new HttpError(400, "Choose a new password with 10 to 128 characters.");
  if (currentPassword === newPassword) throw new HttpError(400, "Choose a password different from your current password.");
  await ensureAuth();
  const db = await getMongoDb(), users = db.collection<Row>("users");
  const prior = await users.findOne({ id: userId });
  if (!prior || !isAdminRole(prior.role)) throw new HttpError(404, "Not found.");
  if (!await checkPassword(currentPassword, String(prior.password_hash))) throw new HttpError(400, "Your current password is incorrect.");
  const hash = await hashPassword(newPassword);
  await withMongoTransaction(async session => {
    const state = await db.collection<Row>("platform_account_status").findOne({ user_id: userId }, { session });
    const updated = await users.findOneAndUpdate({ id: userId, password_hash: prior.password_hash, role: prior.role }, { $set: { password_hash: hash }, $inc: { auth_version: 1 } }, { session, returnDocument: "after" });
    if (!updated || !isAdminRole(updated.role) || !isAccountActive(updated, state)) throw new HttpError(409, "Your account changed. Please sign in again.");
    await db.collection("sessions").deleteMany({ user_id: userId }, { session });
    await db.collection("password_reset_tokens").deleteMany({ user_id: userId }, { session });
    await db.collection("email_otp_codes").deleteMany({ user_id: userId }, { session });
    await auditAuthEvent("password.changed", { userId }, session);
    const id = randomUUID();
    await db.collection<Row>("platform_audit").insertOne({ _id: id, id, actor_id: userId, action: "administrator.password_changed", target_id: userId, details: JSON.stringify({ sessionsRevoked: true }), created_at: new Date().toISOString() }, { session });
  });
  await revokeUserRefreshFamilies(userId).catch(() => undefined);
  await clearLoginFailures(`user:${userId}`).catch(() => undefined);
}
