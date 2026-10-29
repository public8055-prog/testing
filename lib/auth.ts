import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Document } from "mongodb";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { ensurePlatform } from "./platform";
import { isRegistrationConsent, REGISTRATION_POLICY_VERSION, type RegistrationConsent } from "./consent";
import { checkPassword, hashPassword, passwordNeedsUpgrade, DUMMY_PASSWORD_HASH } from "./password-hashing";
import { canonicalRole, ADMIN_ROLES, isAccountActive, isAdminRole, isSuperAdminRole } from "./roles";
import type { AccountUser } from "./auth-types";
import { auditAuthEvent } from "./auth-audit";
import { LOGIN_ATTEMPT_LIMIT, clearLoginFailures, loginLockoutRemaining, recordFailedLogin } from "./auth-state";
import { createSessionTokens, sessionFromCookieHeader, revokeRequestSession, SESSION_COOKIE, REFRESH_COOKIE, sessionCookieOptions, ACCESS_TOKEN_SECONDS, type SessionTokens } from "./auth-sessions";
export { checkPassword, hashPassword } from "./password-hashing";
export { canonicalRole, isAdminRole, isSuperAdminRole } from "./roles";
export { getUserFromCookieHeader, refreshRequestSession } from "./auth-sessions";
export type { AccountUser } from "./auth-types";

type Row = Document & { _id: string };
type UserRecord = Row & { id: string; email: string; name: string; role: string; password_hash: string; created_at: string };
const readiness = new Map<string, Promise<void>>();
export async function ensureAuth() {
  const db = await getMongoDb();
  let ready = readiness.get(db.databaseName);
  if (!ready) {
    ready = (async () => { await ensurePlatform(); await Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true }), db.collection("sessions").createIndex({ token_hash: 1 }, { unique: true }),
      db.collection("sessions").createIndex({ user_id: 1 }), db.collection("sessions").createIndex({ expires_at: 1 }),
      db.collection("admin_alias").createIndex({ alias: 1 }, { unique: true }), db.collection("admin_alias").createIndex({ user_id: 1 }, { unique: true }),
      db.collection("user_consents").createIndex({ user_id: 1, purpose: 1, policy_version: 1 }, { unique: true }),
      db.collection("auth_events").createIndex({ user_id: 1, created_at: -1 }), db.collection("auth_events").createIndex({ created_at: -1 }),
    ]); })().catch(error => { readiness.delete(db.databaseName); throw error; });
    readiness.set(db.databaseName, ready);
  }
  await ready;
}
function account(user: UserRecord): AccountUser { return { id: user.id, email: user.email, name: user.name, role: canonicalRole(user.role), email_verified: user.email_verified }; }
async function authenticatedRecord(identifier: string, password: string, ip?: string): Promise<UserRecord> {
  await ensureAuth(); const db = await getMongoDb(), normalized = identifier.trim().toLowerCase();
  const alias = await db.collection<Row>("admin_alias").findOne({ alias: normalized });
  let user = alias ? await db.collection<UserRecord>("users").findOne({ id: String(alias.user_id), role: { $in: [...ADMIN_ROLES] } }) : await db.collection<UserRecord>("users").findOne({ email: normalized });
  const lockIdentity = user ? `user:${user.id}` : `identity:${normalized}`;
  const valid = await checkPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  const state = user ? await db.collection<Row>("platform_account_status").findOne({ user_id: user.id }) : null;
  if (!user || !valid || !isAccountActive(user, state)) {
    // Password sign-in budgets count failures only. A proven valid password
    // can recover an active account even after its failure budget is exhausted.
    const locked = await loginLockoutRemaining(lockIdentity);
    if (locked) {
      await auditAuthEvent("login.locked", { userId: user?.id, identity: normalized, ip });
      throw new HttpError(429, "Too many failed sign-in attempts. Please try again later.", locked);
    }
    const failures = await recordFailedLogin(lockIdentity);
    await auditAuthEvent("login.failed", { userId: user?.id, identity: normalized, ip });
    if (failures >= LOGIN_ATTEMPT_LIMIT) throw new HttpError(429, "Too many failed sign-in attempts. Please try again later.", await loginLockoutRemaining(lockIdentity));
    throw new HttpError(401, "Login details are incorrect, or the account is unavailable.");
  }
  // Sign-in does not prove mailbox ownership; booking APIs enforce verification.
  if (passwordNeedsUpgrade(user.password_hash)) {
    const upgraded = await hashPassword(password), users = db.collection<UserRecord>("users");
    // Hash outside the transaction; never replace a password reset or a concurrent upgrade.
    const changed = await users.findOneAndUpdate({ id: user.id, password_hash: user.password_hash, ...(alias ? { role: { $in: [...ADMIN_ROLES] } } : {}) }, { $set: { password_hash: upgraded } }, { returnDocument: "after" });
    if (changed) user = changed;
    else { const latest = await users.findOne({ id: user.id, ...(alias ? { role: { $in: [...ADMIN_ROLES] } } : {}) }); if (!latest || !await checkPassword(password, latest.password_hash)) throw new HttpError(401, "Login details changed. Please sign in again."); user = latest; }
    await auditAuthEvent("password.hash_upgraded", { userId: user.id });
  }
  // Conditional role normalization cannot overwrite a simultaneous operator role change.
  await db.collection<UserRecord>("users").updateOne({ id: user.id, role: user.role }, { $set: { role: canonicalRole(user.role) } });
  const latest = await db.collection<UserRecord>("users").findOne({ id: user.id, password_hash: user.password_hash });
  const active = await db.collection<Row>("platform_account_status").findOne({ user_id: user.id });
  if (!latest || !isAccountActive(latest, active) || alias && !isAdminRole(latest.role)) throw new HttpError(401, "This account is unavailable.");
  await clearLoginFailures(lockIdentity);
  return latest;
}
export async function authenticateUser(identifier: string, password: string): Promise<AccountUser> { return account(await authenticatedRecord(identifier, password)); }
export async function applySessionCookies(tokens: SessionTokens) {
  const jar = await cookies(), options = sessionCookieOptions();
  jar.set(SESSION_COOKIE, tokens.accessToken, { ...options, maxAge: ACCESS_TOKEN_SECONDS });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...options, maxAge: Math.max(1, Math.floor((Date.parse(tokens.refreshExpiresAt) - Date.now()) / 1000)) });
}
export async function clearAuthenticationCookies() { const jar = await cookies(); for (const name of [SESSION_COOKIE, REFRESH_COOKIE]) jar.set(name, "", { ...sessionCookieOptions(), maxAge: 0 }); }
export async function createSession(userId: string, expectedPasswordHash?: string, ip?: string) {
  await ensureAuth(); const tokens = await createSessionTokens(userId, expectedPasswordHash, ip); await applySessionCookies(tokens); return { user: tokens.user, accessExpiresAt: tokens.accessExpiresAt };
}
export async function loginSessionWithPassword(identifier: string, password: string, ip?: string) { const user = await authenticatedRecord(identifier, password, ip); return createSession(user.id, user.password_hash, ip); }
export async function loginWithPassword(identifier: string, password: string): Promise<AccountUser> { return (await loginSessionWithPassword(identifier, password)).user; }
export async function getCurrentSession() { const jar = await cookies(); return sessionFromCookieHeader(jar.toString()); }
export async function getCurrentUser(): Promise<AccountUser | null> { return (await getCurrentSession())?.user || null; }
export async function requireUser() { const user = await getCurrentUser(); if (!user) throw new HttpError(401, "Please sign in to continue."); return user; }
export async function requireAdmin() { const user = await getCurrentUser(); if (!user || !isAdminRole(user.role)) throw new HttpError(404, "Not found."); return user; }
export async function requireSuperAdmin() { const user = await getCurrentUser(); if (!user || !isSuperAdminRole(user.role)) throw new HttpError(404, "Not found."); return user; }
export async function logout() { const jar = await cookies(); await revokeRequestSession(jar.toString()); await clearAuthenticationCookies(); }
export async function registerUser(name: string, email: string, password: string, consent?: RegistrationConsent, options: { requireVerification?: boolean } = {}): Promise<AccountUser> {
  if (consent !== undefined && !isRegistrationConsent(consent)) throw new HttpError(400, "Accept the terms and privacy policy and confirm that you are 18 or older.");
  await ensureAuth(); const id = randomUUID(), hash = await hashPassword(password), normalized = email.trim().toLowerCase(), createdAt = new Date().toISOString(), db = await getMongoDb();
  try { await withMongoTransaction(async session => {
    await db.collection<UserRecord>("users").insertOne({ _id: id, id, email: normalized, name, password_hash: hash, role: "CUSTOMER", email_verified: options.requireVerification ? 0 : 1, created_at: createdAt }, { session });
    if (consent) await db.collection<Row>("user_consents").insertOne({ _id: `${id}:signup:${REGISTRATION_POLICY_VERSION}`, user_id: id, purpose: "account-registration", policy_version: REGISTRATION_POLICY_VERSION, terms_version: REGISTRATION_POLICY_VERSION, privacy_version: REGISTRATION_POLICY_VERSION, terms_accepted: true, privacy_consent: true, adult_confirmed: true, recorded_at: createdAt, source: "signup" }, { session });
    await auditAuthEvent("account.registered", { userId: id }, session);
  }); } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) throw new HttpError(409, "An account with this email already exists."); throw error; }
  return { id, email: normalized, name, role: "CUSTOMER" };
}
