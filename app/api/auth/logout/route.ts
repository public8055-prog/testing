import { logout } from "@/lib/auth";
import { assertSameOrigin, apiError } from "@/lib/http";
import { publicRequestUrl } from "@/lib/request-origin";
export async function POST(req:Request){try{assertSameOrigin(req);await logout();if(req.headers.get("accept")?.includes("text/html"))return new Response(null,{status:303,headers:{Location:new URL("/login",publicRequestUrl(req.url)).href,"Cache-Control":"no-store"}});return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
