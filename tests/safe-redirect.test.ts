import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeRedirectPath } from "../lib/safe-redirect";

test("authentication return paths preserve internal destinations and canonicalize dot segments", () => {
  for (const path of ["/", "/checkout", "/admin/dashboard", "/provider/bookings", "/dashboard/tracking?tokenId=catalog%3ABK-qa#timeline", "/services?search=deep%20cleaning"]) {
    assert.equal(safeRedirectPath(path), path);
    assert.equal(new URL(safeRedirectPath(path), "https://app.example.test").origin, "https://app.example.test");
  }
  assert.equal(safeRedirectPath("/dashboard/../checkout"), "/checkout");
});

test("external, control-character and nested encoded separator return paths cannot redirect off-origin", () => {
  const attacks = [
    "https://attacker.test", "javascript:alert(1)", "//attacker.test", "///attacker.test", "\\attacker.test", "/\\attacker.test",
    "/\t/attacker.test", "/\n/attacker.test", "/\r/attacker.test", "/\0/attacker.test", "/\x7f/attacker.test",
    "/%2fattacker.test", "/%2F%2Fattacker.test", "/%5cattacker.test", "/%255cattacker.test", "/%252f%252fattacker.test",
    "/%250a/attacker.test", "/%0D%0a/attacker.test", "/%00/attacker.test", "/%7f/attacker.test", "/%25252525252f/attacker.test",
    "/safe/..//attacker.test", "/safe/%2e%2e//attacker.test", "/%E0%A4%A", "/bad%encoding", "/%",
  ];
  for (const path of attacks) assert.equal(safeRedirectPath(path), "/dashboard", JSON.stringify(path));
});

test("refresh return paths cannot loop back to the refresh boundary after decoding or normalization", () => {
  for (const path of ["/session", "/session/refresh?next=/dashboard", "/%73ession/refresh", "/dashboard/../session/refresh", "/%2573ession/refresh"]) {
    assert.equal(safeRedirectPath(path), "/dashboard");
  }
});

test("invalid return values and unsafe fallbacks resolve to a known application path", () => {
  for (const path of [null, undefined, 123, ["/checkout"], { next: "/checkout" }, "", "checkout", "/" + "x".repeat(2048)]) assert.equal(safeRedirectPath(path), "/dashboard");
  assert.equal(safeRedirectPath("//attacker.test", "/admin/dashboard"), "/admin/dashboard");
  assert.equal(safeRedirectPath(null, "//attacker.test"), "/dashboard");
  assert.equal(safeRedirectPath(null, "/session/refresh"), "/dashboard");
});
