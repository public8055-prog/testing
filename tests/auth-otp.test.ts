import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mongoFixture } from "./helpers/mongo-fixture";
import { registerUser } from "../lib/auth";
import { issueEmailOtp, consumePasswordResetOtp } from "../lib/auth-otp";
import { HttpError } from "../lib/http";
import { POST as requestCode } from "../app/api/auth/otp/request/route";
import { POST as verifyCode } from "../app/api/auth/otp/verify/route";

test("email recovery codes enforce purpose, expiry and one atomic consumption under parallel requests", async () => {
  const fixture = await mongoFixture("otp"), saved = { SMTP_HOST: process.env.SMTP_HOST, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS, APP_URL: process.env.APP_URL };
  // No email is sent: the trusted issuer supplies codes only to this fixture.
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_USER: "qa@example.test", SMTP_PASS: randomUUID(), APP_URL: "http://localhost:3000" });
  try {
    const user = await registerUser("QA code owner", `code-${randomUUID()}@example.test`, `QA-${randomUUID()}!`);
    const wrongPurpose = await issueEmailOtp(user.id, user.email, "verify");
    await assert.rejects(() => consumePasswordResetOtp(user.email, wrongPurpose), (error: unknown) => error instanceof HttpError && error.status === 401);
    const code = await issueEmailOtp(user.id, user.email, "reset");
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => consumePasswordResetOtp(user.email, code)));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await fixture.db.collection("email_otp_codes").countDocuments({ user_id: user.id }), 0);
    await assert.rejects(() => consumePasswordResetOtp(user.email, code), (error: unknown) => error instanceof HttpError && error.status === 401);
    const expired = await issueEmailOtp(user.id, user.email, "reset");
    await fixture.db.collection("email_otp_codes").updateOne({ _id: user.id as never }, { $set: { expires_at: "2000-01-01T00:00:00.000Z" } });
    await assert.rejects(() => consumePasswordResetOtp(user.email, expired), (error: unknown) => error instanceof HttpError && error.status === 401);
    const request = (route: string, data: unknown) => new Request(`http://localhost:3000/api/auth/otp/${route}`, { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    for (let index = 0; index < 11; index++) {
      const response = await requestCode(request("request", { email: `missing-${randomUUID()}@example.test`, purpose: "login" }));
      assert.equal(response.status, 202, "Separate email addresses have independent budgets");
    }
    for (let index = 0; index < 10; index++) {
      const response = await verifyCode(request("verify", { email: "limited@example.test", code: "000000", purpose: "login" }));
      assert.equal(response.status, 401);
    }
    const limited = await verifyCode(request("verify", { email: "limited@example.test", code: "000000", purpose: "login" }));
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await fixture.close();
  }
});
