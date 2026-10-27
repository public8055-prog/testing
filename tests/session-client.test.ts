import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sessionFetch } from "../lib/session-client";

const origin = "https://app.example.test";
const customer = { id: "qa-customer", name: "QA Customer", email: "qa@example.test", role: "CUSTOMER" };
const fresh = (user = customer) => ({ user, accessExpiresAt: new Date(Date.now() + 900000).toISOString() });
type Handler = (request: Request) => Promise<Response> | Response;

async function browser(handler: Handler, action: () => Promise<void>) {
  const descriptors = new Map(["location", "navigator", "window", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input instanceof Request ? input : new URL(String(input), origin), init)) });
  try { await action(); }
  finally { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}

test("expired access retries a rejected mutation once with its exact body and idempotency key", async () => {
  const calls: { path: string; body: string; key: string | null }[] = [];
  await browser(async request => {
    const path = new URL(request.url).pathname;
    calls.push({ path, body: await request.text(), key: request.headers.get("Idempotency-Key") });
    if (path === "/api/auth/me") return Response.json({ user: null });
    if (path === "/api/auth/refresh") return Response.json(fresh());
    return Response.json({ ok: calls.filter(call => call.path === path).length > 1 }, { status: calls.filter(call => call.path === path).length > 1 ? 200 : 401 });
  }, async () => {
    const result = await sessionFetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "qa-request-key" }, body: '{"service":"cleaning","quantity":1}' });
    assert.equal(result.status, 200);
    assert.deepEqual(calls.map(call => call.path), ["/api/bookings", "/api/auth/me", "/api/auth/refresh", "/api/bookings"]);
    assert.deepEqual(calls[0], calls[3]);
  });
});

test("a second 401 or a rejected refresh cannot create a retry loop", async () => {
  for (const accepted of [true, false]) {
    const paths: string[] = [];
    await browser(request => {
      const path = new URL(request.url).pathname; paths.push(path);
      if (path === "/api/auth/me") return Response.json({ user: null });
      if (path === "/api/auth/refresh") return Response.json(accepted ? fresh() : { error: "Sign in again" }, { status: accepted ? 200 : 401 });
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }, async () => {
      assert.equal((await sessionFetch("/api/workforce")).status, 401);
      assert.equal(paths.filter(path => path === "/api/auth/refresh").length, 1);
      assert.equal(paths.filter(path => path === "/api/workforce").length, accepted ? 2 : 1);
    });
  }
});

test("administration refreshes before sending while genuine 404 results are never replayed", async () => {
  for (const [path, method] of [["/api/admin/users", "GET"], ["/api/platform", "PATCH"], ["/api/notifications", "POST"]]) {
    const paths: string[] = [];
    await browser(request => {
      const pathname = new URL(request.url).pathname; paths.push(pathname);
      if (pathname === "/api/auth/me") return Response.json({ user: null });
      if (pathname === "/api/auth/refresh") return Response.json(fresh({ ...customer, role: "ADMIN" }));
      return new Response("Not found", { status: 404 });
    }, async () => {
      assert.equal((await sessionFetch(path, { method })).status, 404);
      assert.deepEqual(paths, ["/api/auth/me", "/api/auth/refresh", path]);
    });
  }
});

test("a valid customer session does not rotate or replay a denied administration request", async () => {
  const paths: string[] = [];
  await browser(request => {
    const path = new URL(request.url).pathname; paths.push(path);
    return path === "/api/auth/me" ? Response.json(fresh()) : new Response("Not found", { status: 404 });
  }, async () => {
    assert.equal((await sessionFetch("/api/admin/users")).status, 404);
    assert.deepEqual(paths, ["/api/auth/me", "/api/admin/users"]);
  });
});

test("auth, foreign, public and credential-free requests do not initiate cookie refresh", async () => {
  const paths: string[] = [];
  await browser(request => { paths.push(new URL(request.url).pathname); return new Response(null, { status: 401 }); }, async () => {
    for (const [url, init] of [["/api/auth/login", undefined], ["https://other.example.test/api/data", undefined], ["/public-data", undefined], ["/api/workforce", { credentials: "omit" }]] as const) {
      assert.equal((await sessionFetch(url, init)).status, 401);
    }
    assert.equal(paths.length, 4);
    assert.equal(paths.includes("/api/auth/me"), false);
  });
  for (const status of [403, 404, 409, 429, 500, 503]) {
    let count = 0;
    await browser(() => { count++; return new Response(null, { status }); }, async () => {
      assert.equal((await sessionFetch("/api/bookings/qa")).status, status); assert.equal(count, 1);
    });
  }
});

test("simultaneous authentication failures share one refresh and preserve each request", async () => {
  let refreshes = 0, checks = 0;
  const counts = new Map<string, number>();
  await browser(async request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/me") { checks++; await new Promise(resolve => setTimeout(resolve, 5)); return Response.json({ user: null }); }
    if (path === "/api/auth/refresh") { refreshes++; return Response.json(fresh()); }
    const count = (counts.get(path) || 0) + 1; counts.set(path, count);
    return new Response(null, { status: count === 1 ? 401 : 200 });
  }, async () => {
    const responses = await Promise.all([sessionFetch("/api/notifications"), sessionFetch("/api/service-tracking")]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(refreshes, 1); assert.equal(checks, 1);
  });
});

test("cancelled requests and unavailable authentication dependencies never send a mutation", async () => {
  for (const abortAfterResponse of [false, true]) {
    const controller = new AbortController(); let calls = 0;
    if (!abortAfterResponse) controller.abort();
    await browser(() => { calls++; controller.abort(); return new Response(null, { status: 401 }); }, async () => {
      await assert.rejects(sessionFetch("/api/workforce", { method: "POST", body: "qa", signal: controller.signal }), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
      assert.equal(calls, abortAfterResponse ? 1 : 0);
    });
  }
  const paths: string[] = [];
  await browser(request => { paths.push(new URL(request.url).pathname); return new Response(null, { status: 503 }); }, async () => {
    await assert.rejects(sessionFetch("/api/admin/users", { method: "PATCH", body: "qa" }), /could not be checked/);
    assert.deepEqual(paths, ["/api/auth/me"]);
  });
});

test("multipart uploads retain their bytes and boundary through an authentication retry", async () => {
  const bodies: string[] = [], types: (string | null)[] = [];
  await browser(async request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/me") return Response.json({ user: null });
    if (path === "/api/auth/refresh") return Response.json(fresh());
    bodies.push(await request.text()); types.push(request.headers.get("Content-Type"));
    return new Response(null, { status: bodies.length === 1 ? 401 : 201 });
  }, async () => {
    const form = new FormData(); form.set("purpose", "provider-document"); form.set("file", new Blob(["qa-document-bytes"], { type: "text/plain" }), "qa.txt");
    assert.equal((await sessionFetch("/api/uploads", { method: "POST", body: form })).status, 201);
    assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(types[0], types[1]); assert.match(bodies[0], /qa-document-bytes/);
  });
});
