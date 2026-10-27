import { getCurrentSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getRefreshUserFromCookieHeader } from "@/lib/auth-sessions";
import {isBuiltinCatalog} from "@/lib/runtime-config.mjs";
export async function GET(req:Request){try{if(isBuiltinCatalog())return Response.json({user:null,accessExpiresAt:null,requiresRefresh:false},{headers:{"Cache-Control":"no-store"}});const session=await getCurrentSession();return Response.json(session||{user:null,accessExpiresAt:null,requiresRefresh:Boolean(await getRefreshUserFromCookieHeader(req.headers.get("cookie")||""))},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
