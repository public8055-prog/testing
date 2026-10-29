import { createHash,randomInt,timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import { getMongoDb } from "./mongo";
import { ensureAuth,createSession } from "./auth";
import { HttpError } from "./http";
import { ADMIN_ROLES,isAccountActive } from "./roles";
import { auditAuthEvent } from "./auth-audit";
import { clearLoginFailures,recordFailedLogin,loginLockoutRemaining } from "./auth-state";
import { sendEmail,smtpConfigured } from "./email";

type Row=Document&{_id:string};
/** Every channel only ever proves mailbox control, so codes are scoped to the step that issued them: signing in, confirming a fresh signup, or recovering a password. */
export type OtpPurpose="login"|"verify"|"reset";
const CODE_TTL_MS=10*60000,CODE_ATTEMPTS=10;
const emailSchema=z.string().trim().toLowerCase().max(254).pipe(z.email());
const codeSchema=/^[0-9]{6}$/;
const otpCopy:Record<OtpPurpose,{subject:string;message:(code:string)=>string}>={
 login:{subject:"Your UrbanKare sign-in code",message:code=>`Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not request this code, you can ignore this email and sign in with your password instead.`},
 verify:{subject:"Confirm your UrbanKare email address",message:code=>`Your verification code is ${code}. It expires in 10 minutes.\n\nIf you did not create a UrbanKare account with this address, you can ignore this email.`},
 reset:{subject:"Reset your UrbanKare password",message:code=>`Your recovery code is ${code}. It expires in 10 minutes.`},
};
let ready:Promise<void>|undefined;
async function ensureOtp(){if(!ready)ready=(async()=>{await ensureAuth();const c=(await getMongoDb()).collection("email_otp_codes");await c.createIndex({user_id:1},{unique:true});await c.createIndex({expires_at:1});})().catch(e=>{ready=undefined;throw e;});await ready;}
function sha256(value:string){return createHash("sha256").update(value).digest("hex");}
/** Email or admin alias, resolved to the owning user record when active. */
async function resolveUser(db:Awaited<ReturnType<typeof getMongoDb>>,identifier:string){
  const normalized=identifier.trim().toLowerCase();
  const alias=await db.collection<Row>("admin_alias").findOne({alias:normalized});
  const user=alias?await db.collection<Row>("users").findOne({id:String(alias.user_id),role:{$in:[...ADMIN_ROLES]}}):await db.collection<Row>("users").findOne({email:normalized});
  if(!user||String(user.email).endsWith("@private-admin.invalid"))return null;
  return isAccountActive(user,await db.collection<Row>("platform_account_status").findOne({user_id:String(user.id)}))?user:null;
}
export function emailOtpConfigured(){return smtpConfigured();}
const unavailableMessage=(purpose:OtpPurpose)=>purpose==="login"?"Email sign-in is not configured. Sign in with your password instead.":"Email verification is not configured yet. Please try again shortly.";
/** Generates and stores a fresh code for one purpose; any previous code for the account stops validating immediately. Returns the plaintext code for callers that bundle it with other content. */
export async function issueEmailOtp(userId:string,email:string,purpose:OtpPurpose,ip?:string){
  await ensureOtp();const db=await getMongoDb();
  const code=String(randomInt(0,1000000)).padStart(6,"0"),salt=randomInt(0,2176782336).toString(36);
  await db.collection<Row>("email_otp_codes").replaceOne({_id:userId},{user_id:userId,purpose,code_hash:sha256(`${salt}:${code}`),salt,attempts:0,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+CODE_TTL_MS).toISOString()},{upsert:true});
  await auditAuthEvent("otp.issued",{userId,ip,reason:`purpose:${purpose}`});
  return code;
}
/** Issues a replacement code by email for the given step; unknown or inactive addresses return silently to prevent account enumeration. */
export async function requestEmailOtp(identifier:string,purpose:OtpPurpose="login",ip?:string){
  if(!emailOtpConfigured())throw new HttpError(503,unavailableMessage(purpose));
  const parsed=emailSchema.safeParse(identifier);if(!parsed.success)return;
  await ensureOtp();const db=await getMongoDb();
  const user=await resolveUser(db,parsed.data);if(!user)return;
  const userId=String(user.id);
  const locked=await loginLockoutRemaining(`user:${userId}`);
  if(locked){await auditAuthEvent("otp.locked",{userId,ip});return;}
  const code=await issueEmailOtp(userId,user.email,purpose,ip);
  const delivered=await sendEmail({to:user.email,subject:otpCopy[purpose].subject,text:otpCopy[purpose].message(code)});
  if(!delivered)throw new HttpError(503,"Email delivery is temporarily unavailable. Please try again shortly.",10);
}
/** Validates a stored code for its purpose and consumes it; failures share the password lockout counters so abuse is bounded across channels. Returns the owning user record. */
async function settleEmailOtp(identifier:string,code:string,purpose:OtpPurpose,ip?:string){
  if(!codeSchema.test(code))throw new HttpError(400,"Enter the 6-digit code we emailed you.");
  const email=emailSchema.safeParse(identifier);if(!email.success)throw new HttpError(400,"Enter the 6-digit code we emailed you.");
  await ensureOtp();const db=await getMongoDb();
  const user=await resolveUser(db,email.data);
  const lock=user?`user:${user.id}`:`identity:${email.data}`;
  const locked=await loginLockoutRemaining(lock);
  if(locked){await auditAuthEvent("otp.locked",{userId:user?.id,identity:email.data,ip});throw new HttpError(429,"Too many failed sign-in attempts. Please try again later.",locked);}
  if(!user){await recordFailedLogin(lock);await auditAuthEvent("otp.failed",{identity:email.data,ip,reason:`attempted:${purpose},held:none`});throw new HttpError(401,"This code is not valid or has expired. Request a new code.");}
  const userId=String(user.id),record=await db.collection<Row>("email_otp_codes").findOne({_id:userId});
  const expired=!record||String(record.expires_at)<=new Date().toISOString();
  const heldPurpose=record&&!expired?String(record.purpose||"login") as OtpPurpose:null;
  const heldReason=`attempted:${purpose},held:${heldPurpose||"none"}${expired?" retired:expired":""}`;
  const valid=heldPurpose===purpose?timingSafeEqual(Buffer.from(String(record!.code_hash)),Buffer.from(sha256(`${record!.salt}:${code}`))):false;
  if(!valid){
    if(!record||expired){
      // Nothing live to burn: the counter still feeds the shared account lockout band.
      await recordFailedLogin(`user:${userId}`);await auditAuthEvent("otp.failed",{userId,ip,reason:heldReason});
      if(record&&expired)throw new HttpError(401,"This code has expired. Request a new code.");
      throw new HttpError(401,"This code is not valid or has expired. Request a new code.");
    }
    if(heldPurpose!==purpose){
      await recordFailedLogin(`user:${userId}`);await auditAuthEvent("otp.failed",{userId,ip,reason:`${heldReason} mismatch`});
      throw new HttpError(401,"This code is not valid for this step. Request a new code.");
    }
    const failures=await recordFailedLogin(`user:${userId}`);
    if(Number(record.attempts)>=CODE_ATTEMPTS-1)await db.collection<Row>("email_otp_codes").deleteOne({_id:userId});
    else await db.collection<Row>("email_otp_codes").updateOne({_id:userId},{$inc:{attempts:1}});
    await auditAuthEvent("otp.failed",{userId,ip,reason:heldReason});
    if(failures>=10)throw new HttpError(429,"Too many failed sign-in attempts. Please try again later.");
    throw new HttpError(401,"This code is not valid. Request a new code.");
  }
  // Consume exactly the code checked above. Concurrent verification has one
  // winner and cannot delete a replacement issued while this request ran.
  const consumed=await db.collection<Row>("email_otp_codes").findOneAndDelete({_id:userId,code_hash:record!.code_hash,salt:record!.salt,purpose,expires_at:{$gt:new Date().toISOString()}});
  if(!consumed)throw new HttpError(401,"This code was already used or replaced. Request a new code.");
  await clearLoginFailures(`user:${userId}`);
  await auditAuthEvent("otp.verified",{userId,ip,reason:`purpose:${purpose}`});
  return user;
}
/** Verifies a sign-in or account-confirmation code, marks the mailbox as verified and opens the session. */
export async function verifyEmailOtp(identifier:string,code:string,purpose:"login"|"verify"="login",ip?:string){
  if(!emailOtpConfigured())throw new HttpError(503,unavailableMessage(purpose));
  const user=await settleEmailOtp(identifier,code,purpose,ip);
  // Both proving paths confirm mailbox control, so owning the code is the verification.
  await (await getMongoDb()).collection<Row>("users").updateOne({id:user.id},{$set:{email_verified:1}});
  return createSession(user.id,undefined,ip);
}
/** Consumes a password-recovery code on behalf of lib/password-reset; that caller performs the mutation atomically. */
export async function consumePasswordResetOtp(identifier:string,code:string,ip?:string){
  if(!emailOtpConfigured())throw new HttpError(503,"Password recovery is not configured. Contact the platform administrator for help.");
  return settleEmailOtp(identifier,code,"reset",ip);
}
