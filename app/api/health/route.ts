import { mongoHealth } from "@/lib/mongo";
import { redisHealth } from "@/lib/redis";
import {isBuiltinCatalog} from "@/lib/runtime-config.mjs";
export const dynamic = "force-dynamic";
export async function GET() {
  if(isBuiltinCatalog())return Response.json({status:"ok",mode:"catalogue",catalogue:"builtin",operations:"not-configured"},{headers:{"Cache-Control":"no-store"}});
  try {
    const [database, cache] = await Promise.all([mongoHealth(), redisHealth()]);
    const ready = database.connected && database.transactions && cache;
    return Response.json({ status: ready ? "ok" : "unhealthy", database: "mongodb", transactions: database.transactions, cache: cache ? "redis" : "unavailable", timestamp: new Date().toISOString() }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "unhealthy" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
