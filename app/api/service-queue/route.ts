import { requireUser } from "@/lib/auth";
import { apiError,assertSameOrigin,rateLimit,readJson } from "@/lib/http";
import { listQueue,mutateQueue } from "@/lib/service-queue";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const user=await requireUser(),params=new URL(request.url).searchParams;return Response.json(await listQueue(user,{provider:params.get("provider")==="1",day:params.get("day")||undefined,serviceId:params.get("serviceId")||undefined,status:params.get("status")==="in_service"?"in_service":undefined}),{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
export async function PATCH(request:Request){try{assertSameOrigin(request);const user=await requireUser();await rateLimit(`service-queue:${user.id}`,60,60000);return Response.json(await mutateQueue(user,await readJson(request)),{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
