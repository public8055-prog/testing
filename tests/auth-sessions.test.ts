import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { mongoFixture } from "./helpers/mongo-fixture";
import { registerUser, authenticateUser } from "../lib/auth";
import { bootstrapAdministrator, seedAdministratorFromEnvironment } from "../lib/admin-bootstrap";
import { createSessionTokens, getUserFromCookieHeader, getRefreshUserFromCookieHeader, refreshRequestSession, revokeUserSessions, sessionCookieOptions, SESSION_COOKIE, REFRESH_COOKIE } from "../lib/auth-sessions";
import { loginLockoutRemaining, clearLoginFailures } from "../lib/auth-state";
import { canonicalRole, isAdminRole, isSuperAdminRole } from "../lib/roles";
import { getRedis, redisScope } from "../lib/redis";
import { HttpError } from "../lib/http";
import { resetPassword } from "../lib/password-reset";
import { POST as loginRoute } from "../app/api/auth/login/route";
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const headers = (tokens: { accessToken: string; refreshToken: string }) => `${SESSION_COOKIE}=${tokens.accessToken}; ${REFRESH_COOKIE}=${tokens.refreshToken}`;

test("JWT access, Redis refresh families and current database roles enforce authentication lifecycle", async t => {
  const fixture = await mongoFixture("authsession"), secret = randomBytes(32).toString("base64");
  process.env.REDIS_URL ||= "redis://127.0.0.1:6380"; process.env.AUTH_JWT_SECRET = secret; process.env.APP_URL = "http://localhost:3000";
  const password = `QA-${randomBytes(18).toString("hex")}!`, user = await registerUser("QA session", "session@example.test", password);
  const stored = await fixture.users.findOne({ id: user.id }); assert.ok(stored);
  const create = () => createSessionTokens(user.id, String(stored.password_hash));
  try {
    await t.test("roles remain compatible and JWT claims cannot override current database authorization", async () => {
      assert.equal(canonicalRole("admin"), "ADMIN"); assert.ok(isAdminRole("SUPER_ADMIN")); assert.ok(isSuperAdminRole("super_admin")); assert.equal(canonicalRole("untrusted-role"), "CUSTOMER");
      const session = await create(), payload = decodeJwt(session.accessToken);
      assert.equal(payload.exp! - payload.iat!, 900); assert.equal((await getUserFromCookieHeader(headers(session)))?.role, "CUSTOMER");
      const family = String(payload.sid), raw = await (await getRedis()).hGetAll(`${redisScope()}:auth:family:${family}`);
      assert.equal(JSON.stringify(raw).includes(session.refreshToken), false); assert.equal(raw.current_hash, createHash("sha256").update(session.refreshToken).digest("hex"));
      await fixture.users.updateOne({ id: user.id }, { $set: { role: "admin" } }); assert.equal((await getUserFromCookieHeader(headers(session)))?.role, "ADMIN");
      await fixture.users.updateOne({ id: user.id }, { $set: { role: "CUSTOMER" } });
      const split = session.accessToken.split("."); split[2] = (split[2][0] === "A" ? "B" : "A") + split[2].slice(1);
      assert.equal(await getUserFromCookieHeader(`${SESSION_COOKIE}=${split.join(".")}`), null);
      const expired = await new SignJWT({ sid: family, role: "SUPER_ADMIN" }).setProtectedHeader({ alg: "HS256" }).setIssuer("urbankare").setAudience("urbankare-web").setSubject(user.id).setJti("expired-fixture").setIssuedAt(Math.floor(Date.now() / 1000) - 1000).setExpirationTime(Math.floor(Date.now() / 1000) - 100).sign(Buffer.from(secret, "base64"));
      assert.equal(await getUserFromCookieHeader(`${SESSION_COOKIE}=${expired}`), null);
      assert.equal((await getRefreshUserFromCookieHeader(headers({ ...session, accessToken: expired })))?.id, user.id);
    });
    await t.test("rotation rejects forged secrets and revokes the whole family when a consumed token is reused", async () => {
      const first = await create(), familyId = first.refreshToken.split(".")[0];
      await assert.rejects(() => refreshRequestSession(`${REFRESH_COOKIE}=${familyId}.${"0".repeat(64)}`), status(401));
      assert.equal((await getUserFromCookieHeader(headers(first)))?.id, user.id, "A guessed secret must not revoke another session");
      const second = await refreshRequestSession(headers(first)); assert.notEqual(first.refreshToken, second.refreshToken);
      assert.equal((await getUserFromCookieHeader(headers(second)))?.id, user.id);
      assert.equal(await getRefreshUserFromCookieHeader(headers(first)), null, "Consumed refresh cookies cannot authorize a refresh routing hint");
      await assert.rejects(() => refreshRequestSession(headers(first)), status(401));
      assert.equal(await getUserFromCookieHeader(headers(second)), null); await assert.rejects(() => refreshRequestSession(headers(second)), status(401));
      assert.equal(await fixture.db.collection("auth_events").countDocuments({ event: "refresh.reuse_detected", family_id: familyId }), 1);
    });
    await t.test("session creation and reload preserve an explicitly unverified mailbox", async () => {
      const pending = await registerUser("QA pending mailbox", "pending@example.test", password, undefined, { requireVerification: true });
      const tokens = await createSessionTokens(pending.id);
      assert.equal(tokens.user.email_verified, 0);
      assert.equal((await getUserFromCookieHeader(headers(tokens)))?.email_verified, 0);
      await fixture.users.updateOne({ id: pending.id }, { $set: { email_verified: 1 } });
      assert.equal((await getUserFromCookieHeader(headers(tokens)))?.email_verified, 1);
    });
    await t.test("concurrent reuse has one rotation winner and still revokes the reused family", async () => {
      const first = await create(), results = await Promise.allSettled([refreshRequestSession(headers(first)), refreshRequestSession(headers(first))]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(await getUserFromCookieHeader(headers(first)), null);
    });
    await t.test("suspension, deletion and explicit account revocation invalidate both token types", async () => {
      const active = await create(); await fixture.users.updateOne({ id: user.id }, { $set: { disabled: true } });
      assert.equal(await getUserFromCookieHeader(headers(active)), null); await assert.rejects(() => refreshRequestSession(headers(active)), status(401));
      await fixture.users.updateOne({ id: user.id }, { $set: { disabled: false, deleted: true } }); assert.equal(await getUserFromCookieHeader(headers(active)), null);
      await fixture.users.updateOne({ id: user.id }, { $set: { deleted: false } });
      const another = await create(); await revokeUserSessions(user.id);
      for (const session of [active, another]) { assert.equal(await getUserFromCookieHeader(headers(session)), null); await assert.rejects(() => refreshRequestSession(headers(session)), status(401)); }
    });
    await t.test("password reset revokes all anchored families and never permits the previous hash to issue a session", async () => {
      const active = await create(), reset = randomBytes(32).toString("hex"), digest = createHash("sha256").update(reset).digest("hex");
      await fixture.db.collection("password_reset_tokens").insertOne({ token_hash: digest, user_id: user.id, expires_at: new Date(Date.now() + 60000).toISOString(), used_at: null });
      await resetPassword(reset, "QA replacement password !"); assert.equal(await getUserFromCookieHeader(headers(active)), null);
      await assert.rejects(() => refreshRequestSession(headers(active)), status(401)); await assert.rejects(create, status(401));
    });
    await t.test("ten incorrect attempts lock the account and separate accounts retain their sign-in budget", async () => {
      const locked = await registerUser("QA lock", "lock@example.test", password);
      for (let index = 0; index < 9; index++) await assert.rejects(() => authenticateUser(locked.email, "wrong password"), status(401));
      await assert.rejects(() => authenticateUser(locked.email, "wrong password"), status(429));
      assert.ok(await loginLockoutRemaining(`user:${locked.id}`) > 850); await assert.rejects(() => authenticateUser(locked.email, password), status(429));
      await clearLoginFailures(`user:${locked.id}`); assert.equal((await authenticateUser(locked.email, password)).id, locked.id);
      for (let index = 0; index < 11; index++) {
        const response = await loginRoute(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ email: `shared-${index}@example.test`, password: "wrong password" }) }));
        assert.equal(response.status, 401, "Separate accounts on one IP each have their own budget");
      }
      const unknown = "missing-rate@example.test";
      for (let index = 0; index < 11; index++) { const response = await loginRoute(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ email: unknown, password: "wrong password" }) })); assert.equal(response.status, index < 9 ? 401 : 429); }
    });
    await t.test("trusted seed upgrades an existing account to SUPER_ADMIN without replacing its id or fabricating consent", async () => {
      const seeded = await registerUser("Existing seed", "seed@example.test", password);
      process.env.SEED_ADMIN_EMAIL = seeded.email; process.env.SEED_ADMIN_PASSWORD = password;
      const result = await seedAdministratorFromEnvironment(); assert.equal(result.id, seeded.id);
      assert.equal((await authenticateUser(seeded.email, password)).role, "SUPER_ADMIN"); assert.equal(await fixture.db.collection("user_consents").countDocuments({ user_id: seeded.id }), 0);
      const alias = await bootstrapAdministrator("qa-private#example.test", password); assert.equal((await authenticateUser("qa-private#example.test", password)).id, alias.id);
      const aliasRecord = await fixture.users.findOne({ id: alias.id }); assert.ok(aliasRecord);
      for (let index = 0; index < 9; index++) await assert.rejects(() => authenticateUser(index % 2 ? String(aliasRecord.email) : "qa-private#example.test", "incorrect password"), status(401));
      await assert.rejects(() => authenticateUser("qa-private#example.test", "incorrect password"), status(429));
      await assert.rejects(() => authenticateUser(String(aliasRecord.email), password), status(429));
      await clearLoginFailures(`user:${alias.id}`);
      process.env.SEED_ADMIN_EMAIL = "qa-private#example.test";
      assert.equal((await seedAdministratorFromEnvironment()).id, alias.id, "The environment seed supports the same private identifiers as shared sign-in");
      process.env.SEED_ADMIN_EMAIL = "invalid identifier";
      await assert.rejects(() => seedAdministratorFromEnvironment());
      delete process.env.SEED_ADMIN_EMAIL; delete process.env.SEED_ADMIN_PASSWORD;
    });
    await t.test("production cookies remain secure except an explicitly configured unpublished loopback preview", () => {
      const previous = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL, COOKIE_SECURE: process.env.COOKIE_SECURE, PUBLIC_LAUNCH_READY: process.env.PUBLIC_LAUNCH_READY };
      try { Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://service.example.test", COOKIE_SECURE: "false", PUBLIC_LAUNCH_READY: "false" }); assert.equal(sessionCookieOptions().secure, true); assert.equal(sessionCookieOptions().sameSite, "lax"); assert.equal(sessionCookieOptions().httpOnly, true); process.env.APP_URL = "http://localhost:3000"; assert.equal(sessionCookieOptions().secure, false); process.env.PUBLIC_LAUNCH_READY = "true"; assert.equal(sessionCookieOptions().secure, true); }
      finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    });
  } finally {
    const redis = await getRedis(), scope = redisScope(); assert.ok(scope.includes(fixture.db.databaseName));
    for await (const keys of redis.scanIterator({ MATCH: `${scope}:*`, COUNT: 100 })) if (keys.length) await redis.del(keys);
    await fixture.close(); delete process.env.AUTH_JWT_SECRET; delete process.env.SEED_ADMIN_EMAIL; delete process.env.SEED_ADMIN_PASSWORD;
  }
});
