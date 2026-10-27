import { requireAdmin } from "@/lib/auth";
import { apiError, rateLimit } from "@/lib/http";
import { adminActivity } from "@/lib/admin-activity";
export const dynamic="force-dynamic";
export async function GET(req:Request){try{const actor=await requireAdmin();await rateLimit(`admin-activity:${actor.id}`,60,60000);return Response.json(await adminActivity(actor,Object.fromEntries(new URL(req.url).searchParams)),{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
