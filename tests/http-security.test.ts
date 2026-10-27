import { strict as assert } from "node:assert";
import { test } from "node:test";
import { apiError, HttpError, readJson, assertSameOrigin } from "../lib/http";
test("JSON requests are byte-bounded even without Content-Length and cancel oversized streams", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(8192).fill(32)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost:3000/api/contact", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(() => readJson(request), (error: unknown) => error instanceof HttpError && error.status === 413);
  assert.equal(cancelled, true);
  await assert.rejects(() => readJson(new Request("http://localhost:3000", { method: "POST", body: '{"message":"' + "€".repeat(12000) + '"}' })), (error: unknown) => error instanceof HttpError && error.status === 413);
  assert.deepEqual(await readJson(new Request("http://localhost:3000", { method: "POST", body: '{"message":"hello"}' })), { message: "hello" });
  await assert.rejects(() => readJson(new Request("http://localhost:3000", { method: "POST", body: new Uint8Array([255, 255]) })), (error: unknown) => error instanceof HttpError && error.status === 400);
});
test("cross-origin mutations fail and error responses cannot be cached", () => {
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/contact", { headers: { Origin: "https://attacker.example" } })), (error: unknown) => error instanceof HttpError && error.status === 403);
  const response = apiError(new HttpError(429, "Too many requests", 12));
  assert.equal(response.headers.get("retry-after"), "12"); assert.equal(response.headers.get("cache-control"), "no-store");
});
