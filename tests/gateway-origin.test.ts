import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isAllowedWebSocketOrigin } from "../scripts/gateway.mjs";

test("production WebSocket origin requires the exact configured origin", () => {
  const configured = "https://app.example.test";
  assert.equal(isAllowedWebSocketOrigin(configured, "app.example.test", configured), true);
  for (const origin of [undefined, "null", "http://app.example.test", "https://attacker.example.test", "https://app.example.test:444", "https://app.example.test/", "https://app.example.test@attacker.example.test", "https://app.example.test.evil.test"]) {
    assert.equal(isAllowedWebSocketOrigin(origin, "app.example.test", configured), false);
  }
});

test("loopback WebSocket preview accepts its actual port without allowing protocol substitution", () => {
  assert.equal(isAllowedWebSocketOrigin("http://localhost:4100", "localhost:4100", "http://localhost:3000"), true);
  assert.equal(isAllowedWebSocketOrigin("http://127.0.0.1:4100", "127.0.0.1:4100", "http://localhost:3000"), true);
  assert.equal(isAllowedWebSocketOrigin("http://[::1]:4100", "[::1]:4100", "http://localhost:3000"), true);
  assert.equal(isAllowedWebSocketOrigin("https://localhost:4100", "localhost:4100", "http://localhost:3000"), false);
  assert.equal(isAllowedWebSocketOrigin("http://localhost:4100", "localhost:4100", "https://localhost:3000"), false);
  assert.equal(isAllowedWebSocketOrigin("http://localhost:4101", "localhost:4100", "http://localhost:3000"), false);
  assert.equal(isAllowedWebSocketOrigin("http://attacker.test:4100", "attacker.test:4100", "http://localhost:3000"), false);
  assert.equal(isAllowedWebSocketOrigin("http://localhost:4100", "attacker.test:4100", "http://localhost:3000"), false);
});
