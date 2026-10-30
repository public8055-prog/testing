import { createHash,randomBytes } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import { getMongoDb,withMongoTransaction } from "./mongo";
import { hashPassword,ensureAuth } from "./auth";
import { HttpError } from "./http";
import { isAccountActive } from "./roles";
import { auditAuthEvent } from "./auth-audit";
import { clearLoginFailures, revokeUserRefreshFamilies } from "./auth-state";
import { sendEmail,smtpConfigured } from "./email";
import { issueEmailOtp,consumePasswordResetOtp } from "./auth-otp";
type Row=Document&{_id:string};
type Db=Awaited<ReturnType<typeof getMongoDb>>;
let ready:Promise<void>|undefined;
async function ensureReset(){if(!ready)ready=(async()=>{await ensureAuth();const c=(await getMongoDb()).collection("password_reset_tokens");await c.createIndex({token_hash:1},{unique:true});await c.createIndex({user_id:1},{unique:true});await c.createIndex({expires_at:1});})().catch(e=>{ready=undefined;throw e;});await ready;}
function webhookConfigured(){try{const endpoint=new URL(process.env.EMAIL_DELIVERY_URL||""),app=new URL(process.env.APP_URL||"");return Boolean(process.env.EMAIL_DELIVERY_TOKEN)&&endpoint.protocol==="https:"&&!endpoint.username&&!endpoint.password&&!app.username&&!app.password&&(app.protocol==="https:"||app.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(app.hostname));}catch{return false;}}
/** SMTP is preferred; the HTTPS webhook adapter stays available as a delivery fallback. */
export function passwordResetConfigured(){return smtpConfigured()||webhookConfigured();}
/** Shared mutation for both recovery paths: rotate the password, sign out every existing session, and record that the mailbox was proven. */
async function commitPasswordResetUser(db:Db,userId:string,passwordHash:string,keepTokenHash:string|null,session:Parameters<Parameters<typeof withMongoTransaction>[0]>[0]){
  await db.collection<Row>("users").updateOne({id:userId},{$set:{password_hash:passwordHash,email_verified:1},$inc:{auth_version:1}},{session});
  await db.collection<Row>("sessions").deleteMany({user_id:userId},{session});
  await db.collection<Row>("password_reset_tokens").deleteMany({user_id:userId,token_hash:{$ne:keepTokenHash}},{session});
  await auditAuthEvent("password.reset",{userId,reason:`method:${keepTokenHash?"link":"code"}`},session);
}
export async function requestPasswordReset(email:string,ip?:string){
 if(!passwordResetConfigured())throw new HttpError(503,"Password recovery is not configured. Contact the platform administrator for help.");await ensureReset();const db=await getMongoDb();
 const user=await db.collection<Row>("users").findOne({email:email.trim().toLowerCase()});if(!user||String(user.email).endsWith("@private-admin.invalid")||!isAccountActive(user,await db.collection<Row>("platform_account_status").findOne({user_id:user.id})))return;
 const token=randomBytes(32).toString("hex"),tokenHash=createHash("sha256").update(token).digest("hex"),now=new Date().toISOString();
 await withMongoTransaction(async session=>{await db.collection<Row>("users").updateOne({id:user.id},{$inc:{reset_version:1}},{session});await db.collection<Row>("password_reset_tokens").deleteMany({$or:[{user_id:user.id},{expires_at:{$lt:now}}]},{session});await db.collection<Row>("password_reset_tokens").insertOne({_id:tokenHash,token_hash:tokenHash,user_id:user.id,expires_at:new Date(Date.now()+30*60000).toISOString(),used_at:null,created_at:now},{session});});
 // The 6-digit code is the primary path; the deep link stays in the same email as a backup option.
 const resetUrl=new URL("/login/reset",process.env.APP_URL);resetUrl.searchParams.set("token",token);
 const code=await issueEmailOtp(String(user.id),user.email,"reset",ip).catch(async error=>{await db.collection<Row>("password_reset_tokens").deleteOne({token_hash:tokenHash}).catch(()=>undefined);throw error;});
 const message={to:user.email,subject:"Reset your SanjuNow password",text:`Your recovery code is ${code}. It expires in 10 minutes.\n\nYou can also open this link within 30 minutes to choose a new password: ${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`};
 try{if(smtpConfigured()){if(!await sendEmail(message))throw new Error("Delivery failed");}else{const response=await fetch(process.env.EMAIL_DELIVERY_URL!,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.EMAIL_DELIVERY_TOKEN}`},body:JSON.stringify(message),signal:AbortSignal.timeout(10000),redirect:"error"});if(!response.ok)throw new Error("Delivery failed");}}catch{await db.collection<Row>("password_reset_tokens").deleteOne({token_hash:tokenHash});await db.collection<Row>("email_otp_codes").deleteOne({_id:String(user.id)});console.error("Password reset delivery failed. Check the configured email adapter.");}
}
export async function resetPassword(token:string,password:string){
 if(!/^[a-f0-9]{64}$/.test(token)||!z.string().min(10).max(128).safeParse(password).success)throw new HttpError(400,"Use a valid recovery link and a password with at least 10 characters.");await ensureReset();const db=await getMongoDb(),tokenHash=createHash("sha256").update(token).digest("hex"),hash=await hashPassword(password);
 const userId=await withMongoTransaction(async session=>{
  const now=new Date().toISOString();
  const record=await db.collection<Row>("password_reset_tokens").findOneAndUpdate({token_hash:tokenHash,used_at:null,expires_at:{$gt:now}},{$set:{used_at:now}},{session,returnDocument:"after"});
  if(!record)throw new HttpError(400,"This recovery link has expired or was already used. Request a new link.");
  const user=await db.collection<Row>("users").findOne({id:record.user_id},{session});if(!isAccountActive(user,await db.collection<Row>("platform_account_status").findOne({user_id:record.user_id},{session})))throw new HttpError(400,"This recovery link is no longer available.");
  await commitPasswordResetUser(db,String(record.user_id),hash,tokenHash,session);return String(record.user_id);
 });
 // Mongo anchors were atomically removed. Redis cleanup is additional; an outage cannot resurrect access.
 await revokeUserRefreshFamilies(userId).catch(()=>undefined);await clearLoginFailures(`user:${userId}`).catch(()=>undefined);
}
/** Completes recovery with the emailed 6-digit code; proving the mailbox also marks the address verified. */
export async function confirmPasswordReset(email:string,code:string,password:string,ip?:string){
 if(!/^[0-9]{6}$/.test(code.trim())||!z.string().min(10).max(128).safeParse(password).success)throw new HttpError(400,"Enter the 6-digit recovery code and a new password with at least 10 characters.");
 await ensureReset();const db=await getMongoDb();
 const user=await consumePasswordResetOtp(email.trim().toLowerCase(),code.trim(),ip),userId=String(user.id),hash=await hashPassword(password);
 await withMongoTransaction(async session=>{await commitPasswordResetUser(db,userId,hash,null,session);});
 await revokeUserRefreshFamilies(userId).catch(()=>undefined);await clearLoginFailures(`user:${userId}`).catch(()=>undefined);
}