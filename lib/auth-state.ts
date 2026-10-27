import { createHash } from "node:crypto";
import { getRedis, redisScope } from "./redis";
import { HttpError } from "./http";
const identity = (value: string) => createHash("sha256").update(value).digest("hex");
const familyKey = (id: string) => `${redisScope()}:auth:family:${id}`;
const userKey = (id: string) => `${redisScope()}:auth:user:${identity(id)}`;
const lockKey = (id: string) => `${redisScope()}:auth:lock:${identity(id)}`;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;
async function available<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, "Authentication is temporarily unavailable. Please try again shortly.", 5); } }
export async function loginLockoutRemaining(id: string) { return available(async () => { const redis = await getRedis(); const count = Number(await redis.get(lockKey(id)) || 0); return count >= 5 ? Math.max(1, await redis.ttl(lockKey(id))) : 0; }); }
export async function recordFailedLogin(id: string) { return available(async () => Number(await (await getRedis()).eval(`local n=redis.call('INCR',KEYS[1]); if n==1 or n==5 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`, { keys: [lockKey(id)], arguments: [String(LOGIN_LOCKOUT_SECONDS)] }))); }
export async function clearLoginFailures(id: string) { await available(async () => { await (await getRedis()).del(lockKey(id)); }); }
export async function createRefreshFamily(userId: string, familyId: string, hash: string, expiresAt: number) {
  await available(async () => {
    const redis = await getRedis(), ttl = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    const result = await redis.eval(`if redis.call('EXISTS',KEYS[1])==1 then return 0 end; redis.call('HSET',KEYS[1],'user_id',ARGV[1],'state','active','current_hash',ARGV[2],'expires_at',ARGV[3]); redis.call('EXPIRE',KEYS[1],ARGV[4]); return 1`, { keys: [familyKey(familyId)], arguments: [userId, hash, String(expiresAt), String(ttl)] });
    if (Number(result) !== 1) throw new Error("Session collision");
    await redis.sAdd(userKey(userId), familyId); await redis.expire(userKey(userId), ttl);
  });
}
export async function refreshFamilyInfo(familyId: string) {
  return available(async () => { const data = await (await getRedis()).hmGet(familyKey(familyId), ["user_id", "state", "expires_at"]); return data[0] ? { userId: data[0], active: data[1] === "active", expiresAt: Number(data[2]) } : null; });
}
/** One hash is current; every consumed hash stays until the family's absolute expiry. */
export async function rotateRefreshFamily(familyId: string, oldHash: string, newHash: string) {
  return available(async () => Number(await (await getRedis()).eval(`
if redis.call('HGET',KEYS[1],'state')~='active' then return 0 end
if redis.call('HEXISTS',KEYS[1],'used:'..ARGV[1])==1 then redis.call('HSET',KEYS[1],'state','revoked'); return -1 end
if redis.call('HGET',KEYS[1],'current_hash')~=ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'used:'..ARGV[1],'1','current_hash',ARGV[2]); return 1
`, { keys: [familyKey(familyId)], arguments: [oldHash, newHash] })));
}
export async function revokeRefreshFamily(familyId: string) { await available(async () => { await (await getRedis()).eval(`if redis.call('EXISTS',KEYS[1])==1 then redis.call('HSET',KEYS[1],'state','revoked') end; return 1`, { keys: [familyKey(familyId)], arguments: [] }); }); }
export async function ownsRefreshToken(familyId: string, hash: string) { return available(async () => Number(await (await getRedis()).eval(`if redis.call('HGET',KEYS[1],'current_hash')==ARGV[1] or redis.call('HEXISTS',KEYS[1],'used:'..ARGV[1])==1 then return 1 end; return 0`, { keys: [familyKey(familyId)], arguments: [hash] })) === 1); }
export async function isCurrentRefreshToken(familyId: string, hash: string) { return available(async () => Number(await (await getRedis()).eval(`if redis.call('HGET',KEYS[1],'state')=='active' and redis.call('HGET',KEYS[1],'current_hash')==ARGV[1] then return 1 end; return 0`, { keys: [familyKey(familyId)], arguments: [hash] })) === 1); }
export async function revokeUserRefreshFamilies(userId: string) {
  await available(async () => { const redis = await getRedis(); for (const familyId of await redis.sMembers(userKey(userId))) await revokeRefreshFamily(familyId); await redis.del(userKey(userId)); });
}
