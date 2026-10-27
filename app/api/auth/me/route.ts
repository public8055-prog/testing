import { getCurrentSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getRefreshUserFromCookieHeader } from "@/lib/auth-sessions";
export async function GET(req:Request){try{const session=await getCurrentSession();return Response.json(session||{user:null,accessExpiresAt:null,requiresRefresh:Boolean(await getRefreshUserFromCookieHeader(req.headers.get("cookie")||""))},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
