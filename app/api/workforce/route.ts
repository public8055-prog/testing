import { requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
import { getWorkforceSnapshot, mutateWorkforce } from "@/lib/workforce";
export const dynamic="force-dynamic";
export async function GET(req:Request) {try{const user=await requireUser();const data=await getWorkforceSnapshot(user.id,new URL(req.url).searchParams.get("month")||undefined);return Response.json(data,{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(req:Request) {try{assertSameOrigin(req);const user=await requireUser();await rateLimit(`workforce:${user.id}`,60,60000);const result=await mutateWorkforce(user.id,await readJson(req));return Response.json(result,{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
