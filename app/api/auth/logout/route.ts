import { logout } from "@/lib/auth";
import { assertSameOrigin, apiError } from "@/lib/http";
export async function POST(req:Request){try{assertSameOrigin(req);await logout();return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
