import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { ensureMarketplace, providerSchema } from "./marketplace";
import { ensureAuth } from "./auth";
import { hashPassword } from "./password-hashing";
import { HttpError } from "./http";
import { requirePersistedAdmin, recordAdminAudit, type AdminActor } from "./admin-access";
import { isAccountActive, isAdminRole } from "./roles";
import { identitySubmissionSchema, validateIdentitySubmission, IDENTITY_POLICY_VERSION } from "./provider-identity";
import { activeCatalogFilter } from "./db";
type Row = Document & { _id: string };
const schema = z.object({ mode: z.enum(["existing", "new"]), email: z.email().max(254).transform(v => v.toLowerCase()), initialPassword: z.string().min(10).max(128).optional(), profile: providerSchema, uploadId: z.string().uuid(), identity: identitySubmissionSchema, consentReference: z.string().trim().min(8).max(250) }).strict();
export async function addAdminProvider(actor: AdminActor, input: unknown) {
  await requirePersistedAdmin(actor);
  const parsed = schema.safeParse(input); if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Check vendor details.");
  const p = parsed.data;
  if (p.mode === "new" && !p.initialPassword) throw new HttpError(400, "Set an initial password of at least 10 characters for the new account.");
  if (p.mode === "existing" && p.initialPassword) throw new HttpError(400, "Existing account passwords cannot be changed here.");
  await ensureAuth(); await ensureMarketplace();
  const db = await getMongoDb(), hash = p.mode === "new" ? await hashPassword(p.initialPassword!) : null;
  try { return await withMongoTransaction(async session => {
    await db.collection<Row>("platform_locks").updateOne({ _id: "admin-mutations" }, { $inc: { version: 1 } }, { upsert: true, session });
    await requirePersistedAdmin(actor, session);
    let user = await db.collection<Row>("users").findOne({ email: p.email }, { session });
    if (p.mode === "new" && user) throw new HttpError(409, "An account already uses that email. Choose existing account.");
    if (p.mode === "existing" && !user) throw new HttpError(404, "No registered account uses that email. Choose new account.");
    if (user && (isAdminRole(user.role) || !isAccountActive(user, await db.collection<Row>("platform_account_status").findOne({ user_id: user.id }, { session })))) throw new HttpError(409, "Choose an active customer/provider account, not an administrator.");
    const now = new Date().toISOString();
    if (!user) { const id = randomUUID(); user = { _id: id, id, name: p.profile.display_name, email: p.email, password_hash: hash, role: "PROVIDER", email_verified: 0, created_at: now }; await db.collection<Row>("users").insertOne(user, { session }); }
    if (await db.collection("marketplace_providers").findOne({ user_id: user.id }, { session })) throw new HttpError(409, "This account already has a provider profile. Review the existing application.");
    const category = await db.collection<Row>("categories").findOne({ ...activeCatalogFilter, slug: p.profile.category }, { session });
    if (!category) throw new HttpError(400, "Choose an active category.");
    const upload = await db.collection<Row>("uploads").findOne({ id: p.uploadId, ownerUserId: actor.id, purpose: "provider-document", visibility: "private" }, { session });
    if (!upload || await db.collection("platform_provider_documents").findOne({ upload_id: p.uploadId }, { session })) throw new HttpError(400, "Choose an unused identity image uploaded by this administrator.");
    const identity = validateIdentitySubmission(p.identity, { mimeType: String(upload.mimeType), documentType: String(upload.documentType) });
    const id = randomUUID(), documentId = randomUUID();
    await db.collection<Row>("marketplace_providers").insertOne({ _id: id, id, user_id: user.id, ...p.profile, category: category.payload.name, active: 0, verified: 0, verification_status: "pending", verification_reason: "Administrator-created application awaiting document review.", reservation_version: 0, created_at: now }, { session });
    await db.collection<Row>("users").updateOne({ id: user.id }, { $set: { role: "PROVIDER", updated_at: now }, $inc: { marketplace_version: 1 } }, { session });
    await db.collection("uploads").updateOne({ id: upload.id, ownerUserId: actor.id }, { $set: { ownerUserId: user.id } }, { session });
    await db.collection<Row>("platform_provider_documents").insertOne({ _id: documentId, id: documentId, provider_id: id, user_id: user.id, upload_id: upload.id, original_name: upload.originalName, document_type: "identity", identity_kind: identity.identityKind, consent_version: IDENTITY_POLICY_VERSION, consent_at: now, consent_recorded_by: actor.id, consent_reference: p.consentReference, redacted: true, status: "pending", reason: "", created_at: now }, { session });
    await recordAdminAudit(actor, "provider.created", id, { userId: user.id, documentId, mode: p.mode }, session);
    return { id, userId: String(user.id), status: "pending", accountCreated: p.mode === "new" };
  }); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new HttpError(409, "An account or application was created concurrently. Reload before retrying."); throw error; }
}
