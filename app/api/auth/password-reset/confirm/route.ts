import { z } from "zod";
import { confirmPasswordReset } from "@/lib/password-reset";
import { apiError,assertSameOrigin,HttpError,rateLimit,readJson,requestIp } from "@/lib/http";
const schema=z.object({email:z.string().trim().toLowerCase().pipe(z.email().max(254)),code:z.string().trim().max(6),password:z.string().min(10).max(128)});
export async function POST(req:Request){
 try{
  assertSameOrigin(req);
  await rateLimit(`reset-confirm:${requestIp(req)}`,15,900000);
  const parsed=schema.safeParse(await readJson(req));
  if(!parsed.success)throw new HttpError(400,"Enter the 6-digit recovery code and a new password with at least 10 characters.");
  await rateLimit(`reset-confirm-email:${parsed.data.email}`,5,900000);
  await confirmPasswordReset(parsed.data.email,parsed.data.code,parsed.data.password,requestIp(req));
  return Response.json({message:"Your password has been updated. Every existing session was signed out."},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return apiError(error);}
}