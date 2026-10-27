import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import { ensureAuth, hashPassword } from "./auth";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { clearLoginFailures, revokeUserRefreshFamilies } from "./auth-state";
import { auditAuthEvent } from "./auth-audit";
type Row = Document & { _id: string };
/** Trusted CLI only. No public HTTP endpoint may call this provisioning function. */
export async function bootstrapAdministrator(identifier: string, password: string, name = "Platform Administrator") {
  const alias = z.string().trim().toLowerCase().min(3).max(254).regex(/^[^\s<>]+$/).parse(identifier);
  z.string().min(10).max(128).parse(password); name = z.string().trim().min(2).max(80).parse(name);
  await ensureAuth(); const db = await getMongoDb(), passwordHash = await hashPassword(password), now = new Date().toISOString();
  const result = await withMongoTransaction(async session => {
    await db.collection<Row>("platform_locks").updateOne({ _id: "admin-mutations" }, { $inc: { version: 1 } }, { session });
    const existing = await db.collection<Row>("admin_alias").findOne({ alias }, { session });
    const email = z.email().safeParse(alias).success ? alias : `${createHash("sha256").update(alias).digest("hex").slice(0, 32)}@private-admin.invalid`;
    const prior = existing ? await db.collection<Row>("users").findOne({ id: String(existing.user_id) }, { session }) : await db.collection<Row>("users").findOne({ email }, { session });
    if (existing && !prior) throw new Error("The administrator alias refers to a missing account.");
    const userId = prior ? String(prior.id) : randomUUID();
    const values = { password_hash: passwordHash, role: "SUPER_ADMIN", name, active: true, disabled: false, deleted: false, deleted_at: null, status: "active" };
    if (prior) await db.collection<Row>("users").updateOne({ id: userId }, { $set: values, $inc: { auth_version: 1 } }, { session });
    else await db.collection<Row>("users").insertOne({ _id: userId, id: userId, email, ...values, created_at: now }, { session });
    if (!existing) {
      // Preserve an existing private alias instead of assigning a second alias to the same account.
      const linked = await db.collection<Row>("admin_alias").findOne({ user_id: userId }, { session });
      if (!linked) await db.collection<Row>("admin_alias").insertOne({ _id: alias, alias, user_id: userId, created_at: now }, { session });
    }
    await db.collection<Row>("platform_account_status").updateOne({ user_id: userId }, { $set: { active: 1, updated_at: now }, $setOnInsert: { _id: userId, user_id: userId } }, { upsert: true, session });
    await db.collection<Row>("sessions").deleteMany({ user_id: userId }, { session });
    await db.collection<Row>("password_reset_tokens").deleteMany({ user_id: userId }, { session });
    const id = randomUUID(); await db.collection<Row>("platform_audit").insertOne({ _id: id, id, actor_id: userId, action: "administrator.bootstrap", target_id: userId, details: JSON.stringify({ method: "protected-cli", role: "SUPER_ADMIN", sessionsRevoked: true }), created_at: now }, { session });
    await auditAuthEvent("administrator.provisioned", { userId }, session); return { id: userId };
  });
  await revokeUserRefreshFamilies(result.id).catch(() => undefined); await clearLoginFailures(`user:${result.id}`).catch(() => undefined); return result;
}
export async function seedAdministratorFromEnvironment() {
  const email = z.string().min(3).max(254).regex(/^[^\s<>]+$/).parse(process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase());
  const password = z.string().min(10).max(128).parse(process.env.SEED_ADMIN_PASSWORD);
  return bootstrapAdministrator(email, password, process.env.SEED_ADMIN_NAME || "Platform Administrator");
}
