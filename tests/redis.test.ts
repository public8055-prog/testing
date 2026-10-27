import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { cachedJson, closeRedis, getRedis, invalidateCatalogCache, sharedRateLimit, withDistributedLock, DistributedLockError } from "../lib/redis";
import { apiError, HttpError, rateLimit } from "../lib/http";

test("Redis provides shared atomic limits, expiring windows and generation-safe public caching", async t => {
  process.env.REDIS_URL ||= "redis://127.0.0.1:6380";
  const prefix = `urbankare_test_redis_${randomUUID().replaceAll("-", "")}`;
  process.env.REDIS_KEY_PREFIX = prefix;
  const redis = await getRedis();
  t.after(async () => {
    assert.match(prefix, /^urbankare_test_redis_[a-f0-9]{32}$/);
    try { for await (const keys of redis.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) { assert.ok(keys.every(key => key.startsWith(`${prefix}:`))); if (keys.length) await redis.del(keys); } }
    finally { await closeRedis(); }
  });

  await t.test("only five of thirty simultaneous requests consume the same window", async () => {
    const identity = "burst:private-customer@example.test", windowMs = 1500;
    const results = await Promise.all(Array.from({ length: 30 }, () => sharedRateLimit(identity, 5, windowMs)));
    assert.equal(results.filter(result => result.allowed).length, 5);
    assert.equal(results.filter(result => !result.allowed).length, 25);
    assert.deepEqual(results.filter(result => result.allowed).map(result => result.remaining).sort(), [0, 1, 2, 3, 4]);
    assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfter >= 1 && result.retryAfter <= 2));
    const key = `${prefix}:rl:${createHash("sha256").update(identity).digest("hex")}`;
    assert.equal(await redis.zCard(key), 5);
    assert.ok(await redis.pTTL(key) > 0);
    assert.ok(!key.includes("private-customer"));
    const independent = await sharedRateLimit("a-different-identity", 5, windowMs);
    assert.equal(independent.allowed, true);
    await delay(windowMs + 100);
    assert.equal((await sharedRateLimit(identity, 5, windowMs)).allowed, true);
    assert.equal(await redis.zCard(key), 1);
  });

  await t.test("HTTP throttling reports a usable Retry-After and recovers on expiry", async () => {
    await rateLimit("short-window", 1, 250);
    let failure: unknown;
    try { await rateLimit("short-window", 1, 250); } catch (error) { failure = error; }
    assert.ok(failure instanceof HttpError);
    assert.equal(failure.status, 429);
    assert.equal(failure.retryAfter, 1);
    const response = apiError(failure);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "1");
    await delay(300);
    await rateLimit("short-window", 1, 250);
  });

  await t.test("concurrent public loads share one fill, cache hits expire, and invalidation loads fresh data", async () => {
    let loads = 0;
    const loader = async () => { loads++; await delay(20); return { price: 300, loads }; };
    const results = await Promise.all(Array.from({ length: 20 }, () => cachedJson("public-services", 1, loader)));
    assert.equal(loads, 1);
    assert.ok(results.every(result => result.price === 300 && result.loads === 1));
    assert.equal((await cachedJson("public-services", 1, loader)).loads, 1);
    await invalidateCatalogCache();
    assert.equal((await cachedJson("public-services", 1, loader)).loads, 2);
    await delay(1100);
    assert.equal((await cachedJson("public-services", 1, loader)).loads, 2, "A stale value is served immediately while one refresh runs");
    await delay(150);
    assert.equal((await cachedJson("public-services", 1, loader)).loads, 3);
  });

  await t.test("a loader started before invalidation cannot overwrite the new generation", async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const isStarted = new Promise<void>(resolve => { started = resolve; });
    const stale = cachedJson("catalog-race", 30, async () => { started(); await blocked; return { price: 100 }; });
    await isStarted;
    await invalidateCatalogCache();
    assert.deepEqual(await cachedJson("catalog-race", 30, async () => ({ price: 250 })), { price: 250 });
    release();
    assert.deepEqual(await stale, { price: 100 });
    assert.deepEqual(await cachedJson("catalog-race", 30, async () => ({ price: -1 })), { price: 250 });
  });
  await t.test("renewable leases serialize concurrent work and release only their own lease", async () => {
    let active = 0, maximum = 0, completed = 0;
    await Promise.all(Array.from({ length: 4 }, () => withDistributedLock("shared-booking-slot", async assertOwned => { active++; maximum = Math.max(maximum, active); await delay(400); assertOwned(); active--; completed++; }, { ttlMs: 1000, waitMs: 5000 })));
    assert.equal(maximum, 1); assert.equal(completed, 4);
    await withDistributedLock("long-owner", async assertOwned => { await delay(1400); assertOwned(); }, { ttlMs: 1000 });
    const resource = "lost-owner", key = `${prefix}:lock:${createHash("sha256").update(resource).digest("hex")}`;
    await assert.rejects(withDistributedLock(resource, async assertOwned => { await redis.set(key, "replacement-owner", { PX: 5000 }); await delay(450); assertOwned(); }, { ttlMs: 1000 }), DistributedLockError);
    assert.equal(await redis.get(key), "replacement-owner", "The previous worker must not delete another worker's lease");
  });
});
