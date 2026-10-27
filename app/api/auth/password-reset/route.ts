import { z } from "zod";
import { after } from "next/server";
import { apiError,assertSameOrigin,HttpError,rateLimit,readJson,requestIp } from "@/lib/http";
import { passwordResetConfigured,requestPasswordReset,resetPassword } from "@/lib/password-reset";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({configured:passwordResetConfigured()},{headers:{"Cache-Control":"no-store"}});}
export async function POST(req:Request){
 try{
  assertSameOrigin(req);
  await rateLimit(`reset-request:${requestIp(req)}`,15,3600000);
  const parsed=z.object({email:z.string().trim().toLowerCase().pipe(z.email().max(254))}).safeParse(await readJson(req));
  if(!parsed.success)throw new HttpError(400,"Enter a valid email address.");
  await rateLimit(`reset-email:${parsed.data.email}`,5,3600000);
  if(!passwordResetConfigured())throw new HttpError(503,"Password recovery is not configured. Contact the platform administrator for help.");
  const email=parsed.data.email,ip=requestIp(req);
  // Look up the account and contact the delivery adapter only after sending the same response to every address.
  after(async()=>{try{await requestPasswordReset(email,ip);}catch{console.error("Password reset request could not be processed. Check database and email adapter availability.");}});
  return Response.json({message:"If an active account matches that address, a 6-digit recovery code and a backup link will be sent. Check your email and spam folder."},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return apiError(error);}
}
export async function PATCH(req:Request){try{assertSameOrigin(req);await rateLimit(`reset-consume:${requestIp(req)}`,15,3600000);const parsed=z.object({token:z.string().max(64),password:z.string().min(10).max(128)}).safeParse(await readJson(req));if(!parsed.success)throw new HttpError(400,"Use a valid recovery link and a password with at least 10 characters.");await resetPassword(parsed.data.token,parsed.data.password);return Response.json({message:"Your password has been changed. Please sign in again."},{headers:{"Cache-Control":"no-store"}});}catch(error){return apiError(error);}}
