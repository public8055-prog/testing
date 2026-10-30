import assert from "node:assert/strict";
import test from "node:test";
import { loginIdentifierSchema, passwordLoginSchema, registrationRequiresEmailVerification } from "../lib/auth-input";

test("shared sign-in and administrator provisioning normalize email and private identifiers consistently", () => {
  for (const value of ["Customer@Example.test", "QA-private#Example.test"]) {
    const credentials = passwordLoginSchema.parse({ email: `  ${value}  `, password: " password remains unchanged " });
    assert.equal(credentials.email, loginIdentifierSchema.parse(value));
    assert.equal(credentials.email, value.toLowerCase());
    assert.equal(credentials.password, " password remains unchanged ");
  }
});

test("missing mail cannot mark a public account verified; only unpublished loopback previews permit password-only registration", () => {
  const preview = { APP_URL: "http://localhost:3005", COOKIE_SECURE: "false", PUBLIC_LAUNCH_READY: "false" };
  assert.equal(registrationRequiresEmailVerification(preview, false), false);
  assert.equal(registrationRequiresEmailVerification(preview, true), true);
  for (const environment of [{}, { ...preview, VERCEL: "1" }, { ...preview, APP_URL: "https://sanjunow.vercel.app" }, { ...preview, PUBLIC_LAUNCH_READY: "true" }, { ...preview, APP_URL: "http://public.example.test" }]) assert.equal(registrationRequiresEmailVerification(environment, false), true);
});

test("sign-in rejects oversized, structured, control-character and markup identifiers", () => {
  for (const email of ["ab", "x".repeat(255), "qa user", "<script>", "qa\u0000user", "qa\u007fuser", { $ne: null }, null]) {
    assert.equal(passwordLoginSchema.safeParse({ email, password: "example" }).success, false);
  }
  for (const password of ["", "p".repeat(129), { $ne: null }]) {
    assert.equal(passwordLoginSchema.safeParse({ email: "qa@example.test", password }).success, false);
  }
});
