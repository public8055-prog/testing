import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mongoFixture } from "./helpers/mongo-fixture";
import { registerUser, authenticateUser } from "../lib/auth";
import { bootstrapAdministrator } from "../lib/admin-bootstrap";
import { changeAdminPassword } from "../lib/admin-password";
import { createSessionTokens, getUserFromCookieHeader, SESSION_COOKIE, REFRESH_COOKIE } from "../lib/auth-sessions";
import { HttpError } from "../lib/http";

test("administrator password changes require proof and revoke sessions and recovery codes", async () => {
  const fixture = await mongoFixture("pwd");
  process.env.AUTH_JWT_SECRET ||= Buffer.from(randomUUID().replaceAll("-", "")).toString("base64");
  const oldPassword = `QA-${randomUUID()}!`, nextPassword = `QA-${randomUUID()}!`;
  try {
    const customer = await registerUser("Customer", "password-customer@example.test", oldPassword);
    await assert.rejects(() => changeAdminPassword(customer.id, oldPassword, nextPassword), (e: unknown) => e instanceof HttpError && e.status === 404);
    const admin = await bootstrapAdministrator("password-admin#example.test", oldPassword);
    const tokens = await createSessionTokens(admin.id);
    const cookie = `${SESSION_COOKIE}=${tokens.accessToken}; ${REFRESH_COOKIE}=${tokens.refreshToken}`;
    assert.ok(await getUserFromCookieHeader(cookie));
    await assert.rejects(() => changeAdminPassword(admin.id, "incorrect-password", nextPassword));
    await assert.rejects(() => changeAdminPassword(admin.id, oldPassword, "short"));
    assert.ok(await getUserFromCookieHeader(cookie));
    await fixture.db.collection("password_reset_tokens").insertOne({ user_id: admin.id, token_hash: randomUUID() });
    await fixture.db.collection("email_otp_codes").insertOne({ user_id: admin.id });
    const outcomes = await Promise.allSettled([changeAdminPassword(admin.id, oldPassword, nextPassword), changeAdminPassword(admin.id, oldPassword, `Other-${randomUUID()}!`)]);
    assert.equal(outcomes.filter(v => v.status === "fulfilled").length, 1);
    assert.equal(await getUserFromCookieHeader(cookie), null);
    await assert.rejects(() => authenticateUser("password-admin#example.test", oldPassword));
    assert.equal(await fixture.db.collection("password_reset_tokens").countDocuments({ user_id: admin.id }), 0);
    assert.equal(await fixture.db.collection("email_otp_codes").countDocuments({ user_id: admin.id }), 0);
    assert.equal(await fixture.db.collection("platform_audit").countDocuments({ actor_id: admin.id, action: "administrator.password_changed" }), 1);
  } finally { await fixture.close(); }
});
