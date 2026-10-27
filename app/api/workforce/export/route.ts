import { requireUser } from "@/lib/auth";
import { apiError, HttpError, rateLimit } from "@/lib/http";
import { getWorkforceSnapshot, workforceCsv } from "@/lib/workforce";
export const dynamic="force-dynamic";
export async function GET(req:Request) {try{const user=await requireUser();await rateLimit(`workforce-export:${user.id}`,15,60000);const data=await getWorkforceSnapshot(user.id,new URL(req.url).searchParams.get("month")||undefined);if(!data.business)throw new HttpError(403,"Business access required.");return new Response(workforceCsv(data),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="attendance-${data.month}.csv"`,"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
