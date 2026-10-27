import { createClient } from "redis";
import { createHash, randomUUID } from "node:crypto";

const newClient = (url: string) => createClient({ url, disableOfflineQueue: true,
  socket: { connectTimeout: 3000, reconnectStrategy: (retries: number) => retries < 3 ? Math.min(1000, 100 * 2 ** retries) : false } });
type RedisClient = ReturnType<typeof newClient>;
const root = globalThis as typeof globalThis & { urbanKareRedis?: { client?: RedisClient; connection?: Promise<RedisClient> } };
const state = (root.urbanKareRedis ??= {});
export const redisScope = () => process.env.REDIS_KEY_PREFIX || `urbankare:${process.env.MONGODB_DB || "urbankare"}`;
const scope = redisScope;

export async function getRedis() {
  if (!state.connection) {
    if (!process.env.REDIS_URL) throw new Error("Configure REDIS_URL for shared rate limiting and caching.");
    const client = newClient(process.env.REDIS_URL);
    client.on("error", () => { /* Never log connection URLs or credentials. Readiness reports availability. */ });
    state.client = client;
    state.connection = client.connect().then(() => client).catch(() => {
      state.connection = undefined; state.client = undefined;
      if (client.isOpen) client.destroy();
      throw new Error("Redis is unavailable.");
    });
  }
  const client = await state.connection;
  if (!client.isReady) { state.connection = undefined; throw new Error("Redis is unavailable."); }
  return client;
}

// Atomic sliding-window log: both allowance and expiry execute on the Redis server.
// Identity is hashed so emails and user ids do not appear in infrastructure keys.
const rateScript = `
local now = redis.call('TIME')
local ms = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ms-window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, tonumber(first[2])+window-ms), 0}
end
redis.call('ZADD', KEYS[1], ms, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0, limit-count-1}
`;
export async function sharedRateLimit(identity: string, limit: number, windowMs: number) {
  const redis = await getRedis();
  const key = `${scope()}:rl:${createHash("sha256").update(identity).digest("hex")}`;
  const result = await redis.eval(rateScript, { keys: [key], arguments: [String(windowMs), String(limit), randomUUID()] }) as number[];
  return { allowed: Number(result[0]) === 1, retryAfter: Math.ceil(Number(result[1]) / 1000), remaining: Number(result[2]) };
}

export async function invalidateCatalogCache() {
  // Bump before and after catalog writes. Old in-flight loaders can only populate old generations.
  await (await getRedis()).incr(`${scope()}:catalog-generation`);
}
export class DistributedLockError extends Error {
  readonly status = 503;
  readonly retryAfter = 1;
  constructor(message = "This operation is busy. Please retry shortly.") { super(message); this.name = "DistributedLockError"; }
}
const releaseLock = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
const renewLock = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
export async function withDistributedLock<T>(resource: string, callback: (assertOwned: () => void) => Promise<T>, options: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const redis = await getRedis(), owner = randomUUID();
  const key = `${scope()}:lock:${createHash("sha256").update(resource).digest("hex")}`;
  const ttlMs = Math.max(1000, Math.min(60000, options.ttlMs ?? 30000));
  const deadline = Date.now() + Math.max(0, Math.min(30000, options.waitMs ?? 5000));
  while (await redis.set(key, owner, { NX: true, PX: ttlMs }) !== "OK") {
    if (Date.now() >= deadline) throw new DistributedLockError();
    await new Promise(resolve => setTimeout(resolve, 40 + Math.floor(Math.random() * 40)));
  }
  let lost = false;
  const heartbeat = setInterval(() => {
    void redis.eval(renewLock, { keys: [key], arguments: [owner, String(ttlMs)] }).then(result => { if (Number(result) !== 1) lost = true; }).catch(() => { lost = true; });
  }, Math.floor(ttlMs / 3));
  heartbeat.unref();
  const assertOwned = () => { if (lost) throw new DistributedLockError("The operation lease expired. Refresh before retrying."); };
  try { const result = await callback(assertOwned); assertOwned(); return result; }
  finally { clearInterval(heartbeat); await redis.eval(releaseLock, { keys: [key], arguments: [owner] }).catch(() => undefined); }
}

const inFlight = new Map<string, Promise<unknown>>();
type CacheEntry<T> = { value: T; freshUntil: number; staleUntil: number };
export async function cachedJson<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  let redis: RedisClient, cacheKey: string, cached: CacheEntry<T> | undefined;
  try {
    redis = await getRedis();
    const generation = await redis.get(`${scope()}:catalog-generation`) || "0";
    cacheKey = `${scope()}:cache:${generation}:${createHash("sha256").update(key).digest("hex")}`;
    const hit = await redis.get(cacheKey);
    if (hit !== null) {
      const parsed = JSON.parse(hit) as CacheEntry<T>;
      if (parsed && typeof parsed.freshUntil === "number" && typeof parsed.staleUntil === "number") cached = parsed;
      if (cached && cached.freshUntil > Date.now()) return cached.value;
    }
  } catch { return loader(); } // Public reads fail open to their authoritative database; protected mutations do not.
  const refresh = () => {
    const existing = inFlight.get(cacheKey);
    if (existing) return existing as Promise<T>;
    const promise = withDistributedLock(`cache:${cacheKey}`, async () => {
      // Another process may have populated the cache while this process waited.
      const current = await redis.get(cacheKey);
      if (current) { const entry = JSON.parse(current) as CacheEntry<T>; if (entry.freshUntil > Date.now()) return entry.value; }
      const value = await loader(), freshMs = Math.max(1, Math.min(300, ttlSeconds)) * 1000;
      const entry: CacheEntry<T> = { value, freshUntil: Date.now() + freshMs, staleUntil: Date.now() + freshMs * 4 };
      await redis.set(cacheKey, JSON.stringify(entry), { PX: freshMs * 4 });
      return value;
    }, { ttlMs: 10000, waitMs: cached ? 0 : 10000 }).finally(() => { inFlight.delete(cacheKey); });
    inFlight.set(cacheKey, promise);
    return promise;
  };
  if (cached && cached.staleUntil > Date.now()) { void refresh().catch(() => undefined); return cached.value; }
  return refresh();
}
export async function redisHealth() { return (await (await getRedis()).ping()) === "PONG"; }
export async function closeRedis() {
  if (state.client?.isOpen) state.client.destroy();
  state.client = undefined; state.connection = undefined; inFlight.clear();
}
