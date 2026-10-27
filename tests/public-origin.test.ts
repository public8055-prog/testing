import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolvePublicOrigin } from "../scripts/public-origin.mjs";

test("public HTTPS origin remains independent from internal listener and preview CLI ports", () => {
  for (const origin of ["https://app.example.test", "https://app.example.test:8443"]) {
    assert.equal(resolvePublicOrigin(origin, 3000), origin);
    assert.equal(resolvePublicOrigin(origin, 3002, { explicitPort: true }), origin);
  }
});

test("configured loopback Docker host ports remain authoritative when PORT controls the listener", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const origin = `http://${host}:3004`;
    assert.equal(resolvePublicOrigin(origin, 3000), origin);
    assert.equal(resolvePublicOrigin(origin, 8080, { explicitPort: false }), origin);
  }
});

test("an explicit local --port override changes only a loopback origin's port", () => {
  assert.equal(resolvePublicOrigin("http://localhost:3004", 3002, { explicitPort: true }), "http://localhost:3002");
  assert.equal(resolvePublicOrigin("http://127.0.0.1:3000", 3002, { explicitPort: true }), "http://127.0.0.1:3002");
  assert.equal(resolvePublicOrigin("https://[::1]:3000", 3002, { explicitPort: true }), "https://[::1]:3002");
});

test("missing APP_URL falls back to the actual loopback listener port", () => {
  assert.equal(resolvePublicOrigin(undefined, 4100), "http://localhost:4100");
  assert.equal(resolvePublicOrigin("", 3002, { explicitPort: true }), "http://localhost:3002");
  assert.equal(resolvePublicOrigin(undefined, 80), "http://localhost");
});

test("origin helper rejects invalid origins and listener ports without echoing configuration", () => {
  for (const origin of ["invalid-private-input", "ftp://localhost:3000", "https://name:private@app.example.test", "https://app.example.test/path", "https://app.example.test/?x=1", "https://app.example.test/#fragment"]) {
    assert.throws(() => resolvePublicOrigin(origin, 3000), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes(origin), false); assert.match(error.message, /public origin/); return true;
    });
  }
  for (const port of [0, -1, 65536, Number.NaN, 3000.5]) assert.throws(() => resolvePublicOrigin(undefined, port), /valid listening port/);
});
