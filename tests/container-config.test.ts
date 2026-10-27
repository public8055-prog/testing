import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { validateContainerConfiguration } from "../scripts/container-entrypoint.mjs";

const valid = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production" as const, AUTH_JWT_SECRET: randomBytes(32).toString("base64"), APP_URL: "http://localhost:3000", COOKIE_SECURE: "false", PUBLIC_LAUNCH_READY: "false", MONGODB_URI: "mongodb://mongo:27017/?replicaSet=rs0", MONGODB_DB: "qa_container_configuration", REDIS_URL: "redis://redis:6379" };
const credential = encodeURIComponent(randomBytes(18).toString("hex"));
const production = { APP_URL: "https://app.example.test", COOKIE_SECURE: "true", MONGODB_URI: `mongodb://qa:${credential}@mongo.example.test:27017/?replicaSet=rs0&tls=true`, REDIS_URL: `rediss://qa:${credential}@redis.example.test:6380` };
const run = (overrides: Record<string, string> = {}, code = "process.stdout.write('QA command started')") => spawnSync(process.execPath, ["scripts/container-entrypoint.mjs", process.execPath, "-e", code], { env: { ...valid, ...overrides }, encoding: "utf8", timeout: 10000 });

test("container entrypoint requires a valid private signing key without printing secrets", () => {
  for (const secret of ["", "public-placeholder-secret", randomBytes(31).toString("base64")]) { const result = run({ AUTH_JWT_SECRET: secret }); assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /AUTH_JWT_SECRET/); if (secret) assert.equal(result.stderr.includes(secret), false); }
});
test("container entrypoint accepts loopback previews and secure HTTPS deployments, rejecting unsafe origins", () => {
  assert.equal(run().status, 0); assert.equal(run(production).status, 0);
  const invalidCases: Record<string,string>[] = [{ APP_URL: "http://public.example.test" }, { APP_URL: "https://app.example.test", COOKIE_SECURE: "false" }, { APP_URL: "http://localhost:3000", PUBLIC_LAUNCH_READY: "true" }, { MONGODB_DB: "../other" }, { REDIS_URL: "http://redis.example.test" }, { APP_URL: "https://user:private@example.test/" }];
  for (const overrides of invalidCases) { const result = run(overrides); assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr.includes("private@example"), false); }
});
test("container entrypoint preserves the child process exit status", () => { assert.equal(run({}, "process.exit(7)").status, 7); });

test("production datastore configuration accepts authenticated verified TLS for SRV, replica lists and Redis ACL/default users", () => {
  const accepted = [
    production,
    { ...production, MONGODB_URI: `mongodb+srv://qa:${credential}@cluster.example.test/application` },
    { ...production, MONGODB_URI: `mongodb://qa:${credential}@mongo1.example.test:27017,mongo2.example.test:27017/?replicaSet=rs0&ssl=true` },
    { ...production, MONGODB_URI: `${production.MONGODB_URI}&tlsAllowInvalidCertificates=false&tlsAllowInvalidHostnames=false` },
    { ...production, REDIS_URL: `rediss://:${credential}@redis.example.test:6380/2` },
  ];
  for (const environment of accepted) assert.doesNotThrow(() => validateContainerConfiguration({ ...valid, ...environment }));
});

test("production rejects plaintext, missing credentials and explicit certificate verification bypasses without printing secrets", () => {
  const overrides: Record<string, string>[] = [
    { MONGODB_URI: `mongodb://qa:${credential}@mongo.example.test:27017/?replicaSet=rs0` },
    { MONGODB_URI: "mongodb://mongo.example.test:27017/?tls=true" },
    { MONGODB_URI: "mongodb+srv://cluster.example.test/application" },
    { MONGODB_URI: "mongodb://qa:@mongo.example.test:27017/?tls=true" },
    { MONGODB_URI: `mongodb+srv://qa:${credential}@cluster.example.test/application?tls=false` },
    { MONGODB_URI: `mongodb+srv://qa:${credential}@cluster.example.test/application?ssl=false` },
    { MONGODB_URI: `${production.MONGODB_URI}&tlsAllowInvalidCertificates=true` },
    { MONGODB_URI: `${production.MONGODB_URI}&tlsAllowInvalidHostnames=true` },
    { MONGODB_URI: `${production.MONGODB_URI}&tlsInsecure=true` },
    { MONGODB_URI: `${production.MONGODB_URI}&TLSALLOWINVALIDCERTIFICATES=true` },
    { MONGODB_URI: `${production.MONGODB_URI}&rejectUnauthorized=false` },
    { REDIS_URL: `redis://qa:${credential}@redis.example.test:6379` },
    { REDIS_URL: "rediss://redis.example.test:6380" },
    { REDIS_URL: "rediss://qa:@redis.example.test:6380" },
    { REDIS_URL: `${production.REDIS_URL}?rejectUnauthorized=false` },
    { REDIS_URL: `${production.REDIS_URL}?tls=false` },
    { REDIS_URL: `${production.REDIS_URL}#ignored` },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  ];
  for (const override of overrides) assert.throws(() => validateContainerConfiguration({ ...valid, ...production, ...override }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message.includes(credential), false); assert.match(error.message, /authenticated TLS MongoDB/); return true;
  });
  const refused = run({ ...production, REDIS_URL: `redis://qa:${credential}@redis.example.test:6379` });
  assert.equal(refused.status, 1); assert.equal(refused.stdout, ""); assert.equal(refused.stderr.includes(credential), false);
});

test("only explicit unlaunched HTTP loopback previews retain unauthenticated local database support", () => {
  assert.doesNotThrow(() => validateContainerConfiguration(valid));
  for (const override of [{ APP_URL: "https://localhost:3000", COOKIE_SECURE: "true" }, { APP_URL: "http://localhost:3000", PUBLIC_LAUNCH_READY: "true" }, { APP_URL: "https://app.example.test", COOKIE_SECURE: "true" }]) {
    assert.throws(() => validateContainerConfiguration({ ...valid, ...override }));
  }
});
