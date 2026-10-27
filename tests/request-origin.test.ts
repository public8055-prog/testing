import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isAllowedRequestOrigin, publicRequestUrl } from "../lib/request-origin";

test("the private gateway's configured origin restores external ports and paths without trusting headers", () => {
  const before = process.env.INTERNAL_GATEWAY_ORIGIN;
  try {
    process.env.INTERNAL_GATEWAY_ORIGIN = "http://localhost:3002";
    const url = publicRequestUrl("http://127.0.0.1:3003/api/auth/login?next=%2Fdashboard");
    assert.equal(url, "http://localhost:3002/api/auth/login?next=%2Fdashboard");
    assert.equal(isAllowedRequestOrigin(url, "http://localhost:3002", "http://localhost:3000"), true);
    assert.equal(isAllowedRequestOrigin(url, "http://localhost:3003", "http://localhost:3000"), false);
    assert.equal(new URL(publicRequestUrl("http://127.0.0.1:3003//untrusted.example/path")).origin, "http://localhost:3002");
    process.env.INTERNAL_GATEWAY_ORIGIN = "https://service.example.test";
    assert.equal(publicRequestUrl("http://127.0.0.1:3001/dashboard"), "https://service.example.test/dashboard");
    process.env.INTERNAL_GATEWAY_ORIGIN = "https://service.example.test/unsafe";
    assert.throws(() => publicRequestUrl("http://127.0.0.1:3001/dashboard"));
  } finally { if (before === undefined) delete process.env.INTERNAL_GATEWAY_ORIGIN; else process.env.INTERNAL_GATEWAY_ORIGIN = before; }
});

test("local sign-in follows the running server port, independent of APP_URL", () => {
  assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", "http://localhost:3000", "http://localhost:3001"), true);
  assert.equal(isAllowedRequestOrigin("http://localhost:3001/api/auth/login", "http://localhost:3001", "http://localhost:3000"), true);
  assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", "http://127.0.0.1:3000", "http://localhost:3001"), true);
});

test("local requests still reject remote origins, other ports and malformed origins", () => {
  for (const origin of ["https://evil.example", "http://localhost:4000", "http://localhost.evil.example:3000", "null", "http://localhost:3000/path", "https://localhost:3000"]) {
    assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", origin, "http://localhost:3001"), false, origin);
  }
});

test("a deployed APP_URL remains the only trusted browser origin behind a proxy", () => {
  assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", "https://home.example", "https://home.example"), true);
  assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", "http://localhost:3000", "https://home.example"), false);
  assert.equal(isAllowedRequestOrigin("http://localhost:3000/api/auth/login", "https://other.example", "https://home.example"), false);
  assert.equal(isAllowedRequestOrigin("https://home.example/api/auth/login", "https://home.example"), true);
});
