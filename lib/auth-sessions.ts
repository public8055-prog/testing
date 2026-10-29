import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";
import type { Document } from "mongodb";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { canonicalRole, isAccountActive, isAdminRole } from "./roles";
import type { AccountUser } from "./auth-types";
import {isBuiltinCatalog} from "./runtime-config.mjs";
import { auditAuthEvent } from "./auth-audit";
import { createRefreshFamily, refreshFamilyInfo, rotateRefreshFamily, revokeRefreshFamily, revokeUserRefreshFamilies, ownsRefreshToken, isCurrentRefreshToken } from "./auth-state";

export const SESSION_COOKIE = "urbankare_session", REFRESH_COOKIE = "urbankare_refresh";
export const ACCESS_TOKEN_SECONDS = 15 * 60, REFRESH_TOKEN_SECONDS = 7 * 86400;
const ISSUER = "urbankare", AUDIENCE = "urbankare-web";
type Row = Document & { _id: string };
export type SessionTokens = { user: AccountUser; accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string };
export function sessionCookieOptions() {
  let loopbackPreview = false;
  try { const url = new URL(process.env.APP_URL || ""); loopbackPreview = process.env.COOKIE_SECURE === "false" && process.env.PUBLIC_LAUNCH_READY !== "true" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); } catch { /* Never relax cookie security for an invalid origin. */ }
  return { httpOnly: true, sameSite: "lax" as const, secure: !loopbackPreview && (process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true"), path: "/" };
}
function secret() {
  const encoded = process.env.AUTH_JWT_SECRET || "", key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new HttpError(503, "Authentication signing is not configured.");
  return key;
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function userView(user: Row): AccountUser { return { id: String(user.id), email: String(user.email), name: String(user.name), role: canonicalRole(user.role), email_verified: user.email_verified === undefined ? undefined : Number(user.email_verified) === 1 ? 1 : 0 }; }
export function cookieValue(header: string, name: string) {
  const values = header.split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return "";
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return ""; }
}
function refreshParts(token: string) {
  const match = /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([a-f0-9]{64})$/.exec(token);
  return match ? { familyId: match[1], hash: hash(token) } : null;
}
async function signedAccess(user: AccountUser, familyId: string) {
  const now = Math.floor(Date.now() / 1000), expires = now + ACCESS_TOKEN_SECONDS;
  const accessToken = await new SignJWT({ sid: familyId, role: user.role }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(user.id).setJti(randomUUID()).setIssuedAt(now).setExpirationTime(expires).sign(secret());
  return { accessToken, accessExpiresAt: new Date(expires * 1000).toISOString() };
}
export async function readAccessClaims(token: string) {
  if (!token || token.length > 4096 || token.split(".").length !== 3) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, requiredClaims: ["sub", "sid", "iat", "exp", "jti"], clockTolerance: 0 });
    if (typeof payload.sub !== "string" || payload.sub.length > 128 || typeof payload.sid !== "string" || !/^[a-f0-9-]{36}$/.test(payload.sid) || typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp - payload.iat > ACCESS_TOKEN_SECONDS || payload.iat > Date.now() / 1000 + 5) return null;
    return { userId: payload.sub, familyId: payload.sid, accessExpiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch (error) { if (error instanceof errors.JOSEError) return null; throw error; }
}
export async function sessionFromCookieHeader(header: string): Promise<{ user: AccountUser; accessExpiresAt: string } | null> {
  if(isBuiltinCatalog())return null;
  const claims = await readAccessClaims(cookieValue(header, SESSION_COOKIE)); if (!claims) return null;
  const family = await refreshFamilyInfo(claims.familyId); if (!family || !family.active || family.userId !== claims.userId || family.expiresAt <= Date.now()) return null;
  const db = await getMongoDb();
  const [anchor, user, state] = await Promise.all([
    db.collection<Row>("sessions").findOne({ _id: claims.familyId, user_id: claims.userId, expires_at: { $gt: new Date().toISOString() } }),
    db.collection<Row>("users").findOne({ id: claims.userId }), db.collection<Row>("platform_account_status").findOne({ user_id: claims.userId }),
  ]);
  if (!anchor || !isAccountActive(user, state)) return null;
  return { user: userView(user!), accessExpiresAt: claims.accessExpiresAt };
}
export async function getUserFromCookieHeader(header: string) { return (await sessionFromCookieHeader(header))?.user || null; }

/** Routing hint for the refresh interstitial only. Protected actions still require an access JWT. */
export async function getRefreshUserFromCookieHeader(header: string): Promise<AccountUser | null> {
  const parts = refreshParts(cookieValue(header, REFRESH_COOKIE)); if (!parts || !await isCurrentRefreshToken(parts.familyId, parts.hash)) return null;
  const family = await refreshFamilyInfo(parts.familyId); if (!family || !family.active || family.expiresAt <= Date.now()) return null;
  const db = await getMongoDb(), [anchor, user, state] = await Promise.all([
    db.collection<Row>("sessions").findOne({ _id: parts.familyId, user_id: family.userId, expires_at: { $gt: new Date().toISOString() } }),
    db.collection<Row>("users").findOne({ id: family.userId }), db.collection<Row>("platform_account_status").findOne({ user_id: family.userId }),
  ]);
  return anchor && isAccountActive(user, state) ? userView(user!) : null;
}

export async function createSessionTokens(userId: string, expectedPasswordHash?: string, ip?: string): Promise<SessionTokens> {
  secret();
  const db = await getMongoDb(), familyId = randomUUID(), refreshToken = `${familyId}.${randomBytes(32).toString("hex")}`, expiresAt = Date.now() + REFRESH_TOKEN_SECONDS * 1000;
  // Redis work stays outside retryable Mongo callbacks. An unanchored family is never valid.
  await createRefreshFamily(userId, familyId, hash(refreshToken), expiresAt);
  let user: AccountUser;
  try {
    user = await withMongoTransaction(async session => {
      const stored = await db.collection<Row>("users").findOneAndUpdate({ id: userId, ...(expectedPasswordHash ? { password_hash: expectedPasswordHash } : {}) }, { $inc: { auth_version: 1 } }, { session, returnDocument: "after" });
      const state = await db.collection<Row>("platform_account_status").findOne({ user_id: userId }, { session });
      if (!isAccountActive(stored, state)) throw new HttpError(401, "This account is unavailable.");
      const view = userView(stored!);
      await db.collection<Row>("sessions").insertOne({ _id: familyId, family_id: familyId, token_hash: hash(familyId), user_id: userId, created_at: new Date().toISOString(), expires_at: new Date(expiresAt).toISOString() }, { session });
      await auditAuthEvent("login.succeeded", { userId, familyId, ip }, session);
      if (isAdminRole(view.role)) { const id = randomUUID(); await db.collection<Row>("platform_audit").insertOne({ _id: id, id, actor_id: userId, action: "auth.admin_login", target_id: userId, details: JSON.stringify({ familyId }), created_at: new Date().toISOString() }, { session }); }
      return view;
    });
  } catch (error) { await revokeRefreshFamily(familyId).catch(() => undefined); throw error; }
  return { user, ...await signedAccess(user, familyId), refreshToken, refreshExpiresAt: new Date(expiresAt).toISOString() };
}
export async function refreshRequestSession(header: string): Promise<SessionTokens> {
  secret();
  const parts = refreshParts(cookieValue(header, REFRESH_COOKIE)); if (!parts) throw new HttpError(401, "Please sign in again.");
  const family = await refreshFamilyInfo(parts.familyId);
  if (!family || !family.active || family.expiresAt <= Date.now()) throw new HttpError(401, "Please sign in again.");
  const db = await getMongoDb();
  const user = await withMongoTransaction(async session => {
    const stored = await db.collection<Row>("users").findOneAndUpdate({ id: family.userId }, { $inc: { auth_version: 1 } }, { session, returnDocument: "after" });
    const state = await db.collection<Row>("platform_account_status").findOne({ user_id: family.userId }, { session });
    const anchor = await db.collection<Row>("sessions").findOne({ _id: parts.familyId, user_id: family.userId, expires_at: { $gt: new Date().toISOString() } }, { session });
    if (!anchor || !isAccountActive(stored, state)) throw new HttpError(401, "Please sign in again.");
    return userView(stored!);
  });
  const refreshToken = `${parts.familyId}.${randomBytes(32).toString("hex")}`, rotated = await rotateRefreshFamily(parts.familyId, parts.hash, hash(refreshToken));
  if (rotated !== 1) {
    if (rotated === -1) { await db.collection<Row>("sessions").deleteOne({ _id: parts.familyId, user_id: family.userId }); await auditAuthEvent("refresh.reuse_detected", { userId: family.userId, familyId: parts.familyId }); }
    throw new HttpError(401, "Please sign in again.");
  }
  await auditAuthEvent("session.refreshed", { userId: user.id, familyId: parts.familyId });
  return { user, ...await signedAccess(user, parts.familyId), refreshToken, refreshExpiresAt: new Date(family.expiresAt).toISOString() };
}
export async function revokeUserSessions(userId: string) {
  await (await getMongoDb()).collection<Row>("sessions").deleteMany({ user_id: userId });
  // The Mongo anchor makes revocation effective even during a Redis outage.
  try { await revokeUserRefreshFamilies(userId); return { redisRevoked: true }; } catch { return { redisRevoked: false }; }
}
export async function revokeRequestSession(header: string) {
  const claims = await readAccessClaims(cookieValue(header, SESSION_COOKIE)), parts = refreshParts(cookieValue(header, REFRESH_COOKIE));
  let familyId = claims?.familyId, userId = claims?.userId;
  if (!familyId && parts && await ownsRefreshToken(parts.familyId, parts.hash)) { familyId = parts.familyId; userId = (await refreshFamilyInfo(familyId))?.userId; }
  if (!familyId || !userId) return;
  await (await getMongoDb()).collection<Row>("sessions").deleteOne({ _id: familyId, user_id: userId });
  await revokeRefreshFamily(familyId).catch(() => undefined);
  await auditAuthEvent("session.logged_out", { userId, familyId });
}
