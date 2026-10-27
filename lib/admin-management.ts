import { randomUUID } from "node:crypto";
import type { ClientSession, Document } from "mongodb";
import { z } from "zod";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { ADMIN_ROLES, SUPER_ADMIN_ROLES, USER_ROLES, canonicalRole, isAccountActive, isAdminRole } from "./roles";
import { requirePersistedAdmin, recordAdminAudit, type AdminActor } from "./admin-access";
import { validateUploadReference } from "./uploads";
import { approvedIdentityDocuments, validateIdentitySubmission, IDENTITY_POLICY_VERSION } from "./provider-identity";

type Row = Document & { _id: string };
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const displayUser = (u: Row, state?: Row | null) => ({ id: String(u.id), name: String(u.name), email: String(u.email), role: canonicalRole(u.role), active: isAccountActive(u, state), deleted: Boolean(u.deleted || u.deleted_at), created_at: String(u.created_at), updated_at: String(u.updated_at || u.created_at) });

export async function listAdminUsers(actor: AdminActor, input: unknown) {
  await requirePersistedAdmin(actor);
  const parsed = z.object({ q: z.string().trim().max(100).default(""), role: z.enum(["all", ...USER_ROLES]).default("all"), status: z.enum(["all", "active", "blocked", "deleted"]).default("all"), page: z.coerce.number().int().min(1).max(100000).default(1) }).safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Check the account filters.");
  const p = parsed.data, db = await getMongoDb(), filters: Document[] = [];
  if (p.q) filters.push({ $or: ["name", "email", "id"].map(key => ({ [key]: { $regex: escapeRegex(p.q), $options: "i" } })) });
  if (p.role !== "all") filters.push({ role: { $in: p.role === "SUPER_ADMIN" ? [...SUPER_ADMIN_ROLES] : p.role === "ADMIN" ? ["ADMIN", "admin"] : p.role === "PROVIDER" ? ["PROVIDER", "provider"] : ["CUSTOMER", "customer", "business"] } });
  const activeExpression = { $and: [{ $ne: ["$active", false] }, { $ne: ["$active", 0] }, { $ne: ["$disabled", true] }, { $not: [{ $ifNull: ["$deleted", false] }] }, { $not: [{ $ifNull: ["$deleted_at", false] }] }, { $not: [{ $in: [{ $toLower: { $ifNull: ["$status", ""] } }, ["disabled", "inactive", "deleted", "suspended"]] }] }, { $ne: [{ $arrayElemAt: ["$account_state.active", 0] }, 0] }] };
  const pipeline: Document[] = [{ $match: filters.length ? { $and: filters } : {} }, { $lookup: { from: "platform_account_status", localField: "id", foreignField: "user_id", as: "account_state" } }, { $set: { account_active: activeExpression, account_deleted: { $or: [{ $toBool: { $ifNull: ["$deleted", false] } }, { $toBool: { $ifNull: ["$deleted_at", false] } }] } } }];
  if (p.status !== "all") pipeline.push({ $match: p.status === "deleted" ? { account_deleted: true } : p.status === "blocked" ? { account_active: false, account_deleted: false } : { account_active: true } });
  pipeline.push({ $facet: { totals: [{ $count: "count" }], rows: [{ $sort: { created_at: -1, id: 1 } }, { $skip: (p.page - 1) * 20 }, { $limit: 20 }, { $project: { id: 1, name: 1, email: 1, role: 1, created_at: 1, updated_at: 1, account_active: 1, account_deleted: 1 } }] } });
  const [result] = await db.collection<Row>("users").aggregate<{ totals: { count: number }[]; rows: Row[] }>(pipeline).toArray();
  return { rows: result.rows.map(u => ({ ...displayUser(u), active: Boolean(u.account_active), deleted: Boolean(u.account_deleted) })), total: result.totals[0]?.count || 0, page: p.page, pageSize: 20 };
}

export async function adminUserDetails(actor: AdminActor, id: string) {
  await requirePersistedAdmin(actor); const db = await getMongoDb();
  const user = await db.collection<Row>("users").findOne({ id }); if (!user) throw new HttpError(404, "Account not found.");
  const [status, profile, bookings, providerBookings, provider, audit] = await Promise.all([
    db.collection<Row>("platform_account_status").findOne({ user_id: id }), db.collection<Row>("platform_profiles").findOne({ user_id: id }),
    db.collection<Row>("bookings").find({ user_id: id }, { projection: { id: 1, status: 1, total: 1, payment_status: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(20).toArray(),
    db.collection<Row>("marketplace_bookings").find({ customer_id: id }, { projection: { id: 1, status: 1, total: 1, payment_status: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(20).toArray(),
    db.collection<Row>("marketplace_providers").findOne({ user_id: id }, { projection: { id: 1, display_name: 1, active: 1, verification_status: 1 } }),
    db.collection<Row>("platform_audit").find({ target_id: id }, { projection: { action: 1, actor_id: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(20).toArray(),
  ]);
  const strip = (r: Row) => { const { _id, ...rest } = r; void _id; return rest; };
  return { user: displayUser(user, status), profile: profile ? { phone: String(profile.phone || ""), address: String(profile.address || "") } : null, bookings: [...bookings, ...providerBookings].map(strip), provider: provider ? strip(provider) : null, audit: audit.map(strip) };
}

const managementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("account"), id: z.string().min(1).max(100), active: z.boolean(), reason: z.string().trim().min(5).max(500).default("Account access reviewed by administrator.") }),
  z.object({ action: z.literal("account-delete"), id: z.string().min(1).max(100), reason: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal("account-role"), id: z.string().min(1).max(100), role: z.enum(USER_ROLES), reason: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal("provider-document-review"), id: z.string().uuid(), status: z.enum(["approved", "rejected"]), reason: z.string().trim().min(5).max(1000), identityChecked: z.boolean().optional() }),
  z.object({ action: z.literal("provider-status"), id: z.string().min(1).max(100), status: z.enum(["pending", "approved", "rejected", "suspended"]), reason: z.string().trim().min(5).max(1000) }),
]);
export const isManagementAction = (action: unknown) => ["account", "account-delete", "account-role", "provider-document-review", "provider-status"].includes(String(action));

async function preserveAdministrator(target: Row, nextRole: string, active: boolean, session: ClientSession) {
  const wasSuper = canonicalRole(target.role) === "SUPER_ADMIN";
  const losesPrivilege = !active || (wasSuper ? nextRole !== "SUPER_ADMIN" : !isAdminRole(nextRole));
  if (!isAdminRole(target.role) || !losesPrivilege) return;
  const db = await getMongoDb(), candidates = await db.collection<Row>("users").find({ id: { $ne: target.id }, role: { $in: wasSuper ? [...SUPER_ADMIN_ROLES] : [...ADMIN_ROLES] } }, { session }).toArray();
  const states = await db.collection<Row>("platform_account_status").find({ user_id: { $in: candidates.map(u => u.id) } }, { session }).toArray();
  if (!candidates.some(u => isAccountActive(u, states.find(s => s.user_id === u.id)))) throw new HttpError(409, wasSuper ? "Keep at least one active super administrator." : "Keep at least one active administrator.");
}

export async function adminManagementMutation(actor: AdminActor, input: unknown) {
  const parsed = managementSchema.safeParse(input); if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Check the request.");
  const p = parsed.data, db = await getMongoDb();
  await withMongoTransaction(async session => {
    await db.collection<Row>("platform_locks").updateOne({ _id: "admin-mutations" }, { $inc: { version: 1 } }, { upsert: true, session });
    const admin = await requirePersistedAdmin(actor, session), now = new Date().toISOString();
    if (p.action.startsWith("account")) {
      if (p.id === actor.id) throw new HttpError(400, "You cannot change your own account access, role or deletion state.");
      const target = await db.collection<Row>("users").findOne({ id: p.id }, { session }); if (!target) throw new HttpError(404, "Account not found.");
      if ((p.action === "account-role" || isAdminRole(target.role)) && admin.role !== "SUPER_ADMIN") throw new HttpError(403, "Only a super administrator can change roles or administrator access.");
      if (target.deleted || target.deleted_at) throw new HttpError(409, "This account has been deleted. Its history is retained.");
      const nextRole = p.action === "account-role" ? p.role : canonicalRole(target.role), active = p.action === "account" ? p.active : p.action !== "account-delete";
      await preserveAdministrator(target, nextRole, active, session);
      const fields: Record<string, unknown> = { updated_at: now };
      if (p.action === "account" && p.active) { fields.active = true; fields.disabled = false; fields.status = "active"; }
      if (p.action === "account-role") fields.role = p.role;
      if (p.action === "account-delete") { fields.deleted = true; fields.deleted_at = now; fields.active = false; }
      await db.collection<Row>("users").updateOne({ id: p.id }, { $set: fields, $inc: { auth_version: 1 } }, { session });
      if (p.action !== "account-role") await db.collection<Row>("platform_account_status").updateOne({ user_id: p.id }, { $set: { active: active ? 1 : 0, reason: p.reason, updated_at: now }, $setOnInsert: { _id: p.id, user_id: p.id } }, { upsert: true, session });
      await db.collection<Row>("sessions").deleteMany({ user_id: p.id }, { session });
      if (!active) await db.collection<Row>("marketplace_providers").updateMany({ user_id: p.id }, { $set: { active: 0, verification_status: "suspended" }, $inc: { reservation_version: 1 } }, { session });
      if (p.action === "account-role" && p.role === "CUSTOMER") await db.collection<Row>("marketplace_providers").updateMany({ user_id: p.id }, { $set: { active: 0, verified: 0, verification_status: "pending", verification_reason: "Account role changed; profile review required." }, $inc: { reservation_version: 1 } }, { session });
    } else if (p.action === "provider-document-review") {
      const doc = await db.collection<Row>("platform_provider_documents").findOne({ id: p.id }, { session }); if (!doc) throw new HttpError(404, "Provider document not found.");
      if (doc.superseded) throw new HttpError(409, "A replacement was submitted. Reload the current documents.");
      if (doc.document_type === "identity" && p.status === "approved") {
        const upload = await db.collection<Row>("uploads").findOne({ id: doc.upload_id, ownerUserId: doc.user_id, purpose: "provider-document", visibility: "private" }, { session });
        if (!upload || doc.consent_version !== IDENTITY_POLICY_VERSION) throw new HttpError(409, "Request a new identity photo with current consent before approval.");
        validateIdentitySubmission({ identityKind: doc.identity_kind, consent: true, redacted: doc.redacted }, { mimeType: String(upload.mimeType), documentType: String(upload.documentType) });
        if (p.identityChecked !== true) throw new HttpError(400, "Confirm the identity photo, matching name and masking checks before approval.");
      }
      await db.collection<Row>("marketplace_providers").updateOne({ id: doc.provider_id }, { $inc: { reservation_version: 1 }, $set: { verified: 0, verification_status: "pending", active: 0 } }, { session });
      await db.collection<Row>("platform_provider_documents").updateOne({ id: p.id }, { $set: { status: p.status, reason: p.reason, identity_checked: p.status === "approved" && p.identityChecked === true, reviewer_id: actor.id, reviewed_at: now } }, { session });
    } else if (p.action === "provider-status") {
      const provider = await db.collection<Row>("marketplace_providers").findOne({ id: p.id }, { session }); if (!provider) throw new HttpError(404, "Provider not found.");
      if (p.status === "approved") {
        const owner = await db.collection<Row>("users").findOne({ id: provider.user_id }, { session }), state = await db.collection<Row>("platform_account_status").findOne({ user_id: provider.user_id }, { session });
        if (!isAccountActive(owner, state)) throw new HttpError(409, "The provider account must be active before approval.");
        await approvedIdentityDocuments(p.id, session);
      }
      await db.collection<Row>("marketplace_providers").updateOne({ id: p.id }, { $set: { verification_status: p.status, verification_reason: p.reason, verified: p.status === "approved" ? 1 : 0, active: p.status === "approved" ? 1 : 0, reviewed_at: now, reviewer_id: actor.id }, $inc: { reservation_version: 1 } }, { session });
    }
    await recordAdminAudit(actor, p.action, p.id, p, session);
  });
}

export async function listProviderDocuments(userId: string, admin?: AdminActor) {
  const db = await getMongoDb(); if (admin) await requirePersistedAdmin(admin);
  const provider = await db.collection<Row>("marketplace_providers").findOne(admin ? { id: userId } : { user_id: userId });
  if (!provider) throw new HttpError(404, "Create your provider profile before submitting documents.");
  const rows = await db.collection<Row>("platform_provider_documents").find({ provider_id: provider.id, superseded: { $ne: true } }).sort({ created_at: -1 }).toArray();
  return { providerId: String(provider.id), status: String(provider.verification_status || (Number(provider.verified) === 1 ? "approved" : "pending")), reason: String(provider.verification_reason || ""), documents: rows.map(r => ({ id: String(r.id), uploadId: String(r.upload_id), url: `/api/uploads/${r.upload_id}`, name: String(r.original_name), type: String(r.document_type), identityKind: String(r.identity_kind || ""), status: String(r.status), reason: String(r.reason || ""), createdAt: String(r.created_at) })) };
}

export async function submitProviderDocument(userId: string, input: unknown) {
  const parsed = z.object({ uploadId: z.string().uuid(), identityKind: z.string().optional(), consent: z.boolean().optional(), redacted: z.boolean().optional() }).strict().safeParse(input); if (!parsed.success) throw new HttpError(400, "Choose an uploaded document.");
  const upload = await validateUploadReference(parsed.data.uploadId, { ownerUserId: userId, purpose: "provider-document" });
  const identity = upload.documentType === "identity" ? validateIdentitySubmission(parsed.data, upload) : null;
  const db = await getMongoDb(), now = new Date().toISOString();
  await withMongoTransaction(async session => {
    const provider = await db.collection<Row>("marketplace_providers").findOneAndUpdate({ user_id: userId }, { $inc: { reservation_version: 1 } }, { session, returnDocument: "after" });
    if (!provider) throw new HttpError(404, "Create your provider profile before submitting documents.");
    const user = await db.collection<Row>("users").findOne({ id: userId }, { session }), state = await db.collection<Row>("platform_account_status").findOne({ user_id: userId }, { session });
    if (!isAccountActive(user, state)) throw new HttpError(403, "Active account required.");
    if (await db.collection<Row>("platform_provider_documents").findOne({ upload_id: upload.id }, { session })) throw new HttpError(409, "This document has already been submitted.");
    const type = String(upload.documentType || "other"), id = randomUUID();
    await db.collection<Row>("platform_provider_documents").updateMany({ provider_id: provider.id, document_type: type, superseded: { $ne: true } }, { $set: { superseded: true } }, { session });
    await db.collection<Row>("platform_provider_documents").insertOne({ _id: id, id, provider_id: provider.id, user_id: userId, upload_id: upload.id, original_name: upload.originalName, document_type: type, ...(identity ? { identity_kind: identity.identityKind, consent_version: IDENTITY_POLICY_VERSION, consent_at: now, redacted: true } : {}), status: "pending", reason: "", created_at: now }, { session });
    await db.collection<Row>("marketplace_providers").updateOne({ id: provider.id }, { $set: { verification_status: "pending", verification_reason: "New document awaiting review.", verified: 0, active: 0 } }, { session });
    await recordAdminAudit({ id: userId, role: String(user?.role) }, "provider-document-submitted", String(provider.id), { documentId: id, type }, session);
  });
}

export async function assertApprovedProviderDocuments(providerId: string, session: ClientSession) {
  await approvedIdentityDocuments(providerId, session);
}
