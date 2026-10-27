import { randomUUID } from "node:crypto";
import type { ClientSession, Document } from "mongodb";
import { z } from "zod";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";

export const WORKFORCE_SCHEMA_VERSION = 2;
export const workforceCollections = ["wf_businesses", "wf_memberships", "wf_workers", "wf_shifts", "wf_attendance", "wf_corrections", "wf_contracts", "wf_audit"] as const;
export type Business = { id:string; name:string; owner_id:string; timezone:string; grace_minutes:number; retention_days:number; created_at:string };
export type Worker = { id:string; business_id:string; user_id:string|null; name:string; email:string; department:string; service:string; active:number; created_at:string };
export type Shift = { id:string; business_id:string; worker_id:string; starts_at:string; ends_at:string; notes:string; status:string; name:string; department:string; service:string; check_in:string|null; check_out:string|null; attendance_status:string|null };
export type Correction = { id:string; shift_id:string; requested_by:string; check_in:string; check_out:string|null; reason:string; status:string; created_at:string; name:string };
export type Contract = { id:string; worker_id:string; title:string; starts_on:string; ends_on:string; monthly_amount:number; scope:string; cancellation_terms:string; status:string; name:string };
export type Audit = { id:string; actor_id:string; action:string; entity_id:string; before_value:string|null; after_value:string|null; created_at:string };
export type WorkforceSnapshot = { business:Business|null; role:"owner"|"manager"|"worker"|null; workers:Worker[]; shifts:Shift[]; todayShifts:Shift[]; corrections:Correction[]; contracts:Contract[]; audit:Audit[]; month:string };
type Stored<T> = T & { _id:string; lock_version?:number };
type UserDocument = Stored<{id:string;email:string;name:string;role:string}>;
type MembershipDocument = {_id:string;business_id:string;user_id:string;role:"owner"|"manager"};
type ShiftDocument = Stored<Omit<Shift,"name"|"department"|"service"|"check_in"|"check_out"|"attendance_status"> & {created_at:string}>;
type AttendanceDocument = Stored<{id:string;shift_id:string;check_in:string;check_out:string|null;status:"present"|"late"|"corrected";recorded_by:string;updated_at:string}>;
type CorrectionDocument = Stored<Omit<Correction,"name"> & {reviewed_by:string|null;reviewed_at:string|null}>;
type ContractDocument = Stored<Omit<Contract,"name"> & {business_id:string;created_at:string}>;
type AuditDocument = Stored<Audit & {business_id:string}>;
type Scope = { business:Business; role:"owner"|"manager"|"worker"; workerId?:string };

async function collections() {
  const db=await getMongoDb();
  return {users:db.collection<UserDocument>("users"),businesses:db.collection<Stored<Business>>("wf_businesses"),memberships:db.collection<MembershipDocument>("wf_memberships"),workers:db.collection<Stored<Worker>>("wf_workers"),shifts:db.collection<ShiftDocument>("wf_shifts"),attendance:db.collection<AttendanceDocument>("wf_attendance"),corrections:db.collection<CorrectionDocument>("wf_corrections"),contracts:db.collection<ContractDocument>("wf_contracts"),audits:db.collection<AuditDocument>("wf_audit")};
}
type Collections=Awaited<ReturnType<typeof collections>>;
const wfGlobal=globalThis as typeof globalThis & {workforceMongoIndexes?:Map<string,Promise<void>>};
export async function initWorkforce() {
  const db=await getMongoDb(),promises=wfGlobal.workforceMongoIndexes??=new Map();
  let ready=promises.get(db.databaseName);
  if(!ready){ready=(async()=>{
    const c=await collections();
    await c.businesses.createIndexes([{key:{id:1},unique:true,name:"wf_business_id"},{key:{owner_id:1},unique:true,name:"wf_business_owner"}]);
    await c.memberships.createIndexes([{key:{business_id:1,user_id:1},unique:true,name:"wf_membership_identity"},{key:{user_id:1},name:"wf_membership_user"}]);
    await c.workers.createIndexes([{key:{id:1},unique:true,name:"wf_worker_id"},{key:{business_id:1,active:1,name:1},name:"wf_worker_business"},{key:{user_id:1,active:1},name:"wf_worker_account"},{key:{business_id:1,email:1},unique:true,partialFilterExpression:{active:1,email:{$gt:""}},name:"wf_active_worker_email"}]);
    await c.shifts.createIndexes([{key:{id:1},unique:true,name:"wf_shift_id"},{key:{worker_id:1,starts_at:1,ends_at:1},name:"wf_worker_shift_time"},{key:{business_id:1,starts_at:1},name:"wf_business_shift_time"}]);
    await c.attendance.createIndexes([{key:{id:1},unique:true,name:"wf_attendance_id"},{key:{shift_id:1},unique:true,name:"wf_attendance_shift"}]);
    await c.corrections.createIndexes([{key:{id:1},unique:true,name:"wf_correction_id"},{key:{shift_id:1},unique:true,partialFilterExpression:{status:"pending"},name:"wf_pending_correction"},{key:{shift_id:1,created_at:-1},name:"wf_correction_history"}]);
    await c.contracts.createIndexes([{key:{id:1},unique:true,name:"wf_contract_id"},{key:{business_id:1,worker_id:1,created_at:-1},name:"wf_contract_business"}]);
    await c.audits.createIndexes([{key:{id:1},unique:true,name:"wf_audit_id"},{key:{business_id:1,created_at:-1},name:"wf_audit_business"}]);
  })().catch(error=>{promises.delete(db.databaseName);throw error;});promises.set(db.databaseName,ready);}
  await ready;
}
function publicRecord<T extends object>(document:Stored<T>):T {const {_id,lock_version,...record}=document;void _id;void lock_version;return record as T;}
async function scope(userId:string,c:Collections,session?:ClientSession):Promise<Scope>{
  const memberships=await c.memberships.find({user_id:userId},{session}).toArray();
  if(memberships.length){const business=await c.businesses.findOne({id:{$in:memberships.map(m=>m.business_id)}},{session,sort:{created_at:1}});if(business)return {business:publicRecord(business),role:memberships.find(m=>m.business_id===business.id)!.role};}
  const workers=await c.workers.find({user_id:userId,active:1},{session}).toArray();
  if(workers.length){const business=await c.businesses.findOne({id:{$in:workers.map(w=>w.business_id)}},{session,sort:{created_at:1}});if(business)return {business:publicRecord(business),role:"worker",workerId:workers.find(w=>w.business_id===business.id)!.id};}
  throw new HttpError(403,"Create a business workspace or ask your employer to link your account.");
}
function manager(s:Scope){if(s.role==="worker")throw new HttpError(403,"A business manager must perform this action.");}
async function audit(c:Collections,session:ClientSession,s:Scope,userId:string,action:string,entityId:string,before:unknown,after:unknown){const id=randomUUID();await c.audits.insertOne({_id:id,id,business_id:s.business.id,actor_id:userId,action,entity_id:entityId,before_value:before==null?null:JSON.stringify(before),after_value:after==null?null:JSON.stringify(after),created_at:new Date().toISOString()},{session});}
export function localDate(iso:string,timezone:string){return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));}
export function localTimeToUtc(value:string,timezone:string){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new HttpError(400,"Use a valid date and time.");
  const target=Date.parse(`${value}:00Z`);if(!Number.isFinite(target))throw new HttpError(400,"Use a valid date and time.");let guess=target;
  const format=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  function parts(ms:number){const p=Object.fromEntries(format.formatToParts(new Date(ms)).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
  for(let i=0;i<3;i++)guess+=target-Date.parse(`${parts(guess)}:00Z`);
  if(parts(guess)!==value)throw new HttpError(400,"This local time does not exist in the business timezone.");return new Date(guess).toISOString();
}
export function attendanceLabel(shift:Shift,now=new Date()){
  if(shift.status==="on_leave")return "On leave";if(shift.status==="cancelled")return "Cancelled";
  if(shift.check_in&&!shift.check_out&&Date.parse(shift.ends_at)<now.getTime())return "Incomplete";
  if(shift.attendance_status==="corrected")return "Corrected";if(shift.attendance_status==="late")return "Late";
  if(shift.check_out)return "Completed";if(shift.check_in)return "Present";
  return Date.parse(shift.ends_at)<now.getTime()?"Absent":"Scheduled";
}
export function workedHours(shift:Pick<Shift,"check_in"|"check_out">){return shift.check_in&&shift.check_out?Math.max(0,(Date.parse(shift.check_out)-Date.parse(shift.check_in))/3600000):0;}
function shiftPipeline(s:Scope,from:string,to:string,ascending=false):Document[]{return [
  {$match:{business_id:s.business.id,starts_at:{$gte:from,$lt:to},...(s.workerId?{worker_id:s.workerId}:{})}},{$sort:{starts_at:ascending?1:-1}},
  {$lookup:{from:"wf_workers",localField:"worker_id",foreignField:"id",as:"worker"}},{$lookup:{from:"wf_attendance",localField:"id",foreignField:"shift_id",as:"attendance"}},
  {$set:{name:{$ifNull:[{$arrayElemAt:["$worker.name",0]},"Former team member"]},department:{$ifNull:[{$arrayElemAt:["$worker.department",0]},""]},service:{$ifNull:[{$arrayElemAt:["$worker.service",0]},""]},check_in:{$ifNull:[{$arrayElemAt:["$attendance.check_in",0]},null]},check_out:{$ifNull:[{$arrayElemAt:["$attendance.check_out",0]},null]},attendance_status:{$ifNull:[{$arrayElemAt:["$attendance.status",0]},null]}}},{$project:{_id:0,lock_version:0,worker:0,attendance:0}},
];}
export async function getWorkforceSnapshot(userId:string,monthInput?:string):Promise<WorkforceSnapshot>{
  await initWorkforce();const c=await collections();let s:Scope;
  try{s=await scope(userId,c);}catch(error){if(error instanceof HttpError&&error.status===403)return {business:null,role:null,workers:[],shifts:[],todayShifts:[],corrections:[],contracts:[],audit:[],month:new Date().toISOString().slice(0,7)};throw error;}
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput||"")?monthInput!:localDate(new Date().toISOString(),s.business.timezone).slice(0,7);
  const [year,m]=month.split("-").map(Number),until=`${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,"0")}-01T00:00`;
  const from=localTimeToUtc(`${month}-01T00:00`,s.business.timezone),to=localTimeToUtc(until,s.business.timezone);
  const today=localDate(new Date().toISOString(),s.business.timezone),tomorrow=new Date(Date.parse(`${today}T00:00Z`)+86400000).toISOString().slice(0,10);
  const todayStart=localTimeToUtc(`${today}T00:00`,s.business.timezone),todayEnd=localTimeToUtc(`${tomorrow}T00:00`,s.business.timezone);
  const [workerDocs,shifts,corrections,contracts,auditDocs,todayShifts]=await Promise.all([
    c.workers.find({business_id:s.business.id,...(s.workerId?{id:s.workerId}:{})}).sort({active:-1,name:1}).toArray(),
    c.shifts.aggregate<Shift>(shiftPipeline(s,from,to)).toArray(),
    c.shifts.aggregate<Correction>([
      {$match:{business_id:s.business.id,...(s.workerId?{worker_id:s.workerId}:{})}},
      {$lookup:{from:"wf_corrections",localField:"id",foreignField:"shift_id",as:"correction"}},{$unwind:"$correction"},
      {$lookup:{from:"wf_workers",localField:"worker_id",foreignField:"id",as:"worker"}},
      {$set:{"correction.name":{$ifNull:[{$arrayElemAt:["$worker.name",0]},"Former team member"]}}},
      {$replaceRoot:{newRoot:"$correction"}},{$sort:{created_at:-1}},{$project:{_id:0,lock_version:0}},
    ]).toArray(),
    c.contracts.aggregate<Contract>([{$match:{business_id:s.business.id,...(s.workerId?{worker_id:s.workerId}:{})}},{$sort:{created_at:-1}},{$lookup:{from:"wf_workers",localField:"worker_id",foreignField:"id",as:"worker"}},{$set:{name:{$ifNull:[{$arrayElemAt:["$worker.name",0]},"Former team member"]}}},{$project:{_id:0,lock_version:0,worker:0}}]).toArray(),
    s.role==="worker"?Promise.resolve([]):c.audits.find({business_id:s.business.id}).sort({created_at:-1}).limit(30).toArray(),
    c.shifts.aggregate<Shift>(shiftPipeline(s,todayStart,todayEnd,true)).toArray(),
  ]);
  return {business:s.business,role:s.role,workers:workerDocs.map(publicRecord),shifts,todayShifts,corrections,contracts,audit:auditDocs.map(publicRecord),month};
}
const short=z.string().trim().min(1).max(120),id=z.string().min(1).max(100),local=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),optionalText=z.string().trim().max(500).default("");
export const workforceActionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create-business"),name:short}),
  z.object({action:z.literal("add-worker"),name:short,email:z.union([z.email(),z.literal("")]).default(""),department:z.string().trim().max(100).default(""),service:z.string().trim().max(100).default("")}),
  z.object({action:z.literal("update-worker"),workerId:id,name:short,email:z.union([z.email(),z.literal("")]).default(""),department:z.string().trim().max(100),service:z.string().trim().max(100),active:z.boolean()}),
  z.object({action:z.literal("create-shift"),workerId:id,start:local,end:local,notes:optionalText}),z.object({action:z.literal("shift-status"),shiftId:id,status:z.enum(["scheduled","on_leave","cancelled"])}),
  z.object({action:z.literal("check-in"),shiftId:id}),z.object({action:z.literal("check-out"),shiftId:id}),
  z.object({action:z.literal("request-correction"),shiftId:id,start:local,end:z.union([local,z.literal("")]).default(""),reason:z.string().trim().min(10).max(1000)}),z.object({action:z.literal("review-correction"),correctionId:id,decision:z.enum(["approved","rejected"])}),
  z.object({action:z.literal("settings"),name:short,timezone:z.string().max(80),graceMinutes:z.number().int().min(0).max(120),retentionDays:z.number().int().min(30).max(3650)}),
  z.object({action:z.literal("create-contract"),workerId:id,title:short,start:z.iso.date(),end:z.iso.date(),monthlyAmount:z.number().int().min(0).max(100000000),scope:z.string().trim().min(10).max(2000),cancellationTerms:z.string().trim().min(10).max(1000)}),z.object({action:z.literal("end-contract"),contractId:id}),
]);
export async function mutateWorkforce(userId:string,input:unknown){
  const parsed=workforceActionSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"Check your details.");
  await initWorkforce();const c=await collections(),d=parsed.data;
  try{return await withMongoTransaction(async session=>{
    const now=new Date().toISOString();
    // A real write forces concurrent Mongo transactions affecting this actor to retry.
    const actor=await c.users.updateOne({id:userId},{$inc:{lock_version:1}},{session});if(!actor.matchedCount)throw new HttpError(401,"Please sign in to continue.");
    // Account deactivation writes this user first; the actor lock and fresh state read
    // prevent an already-authorized request from committing after revocation.
    const accountState=await (await getMongoDb()).collection("platform_account_status").findOne({user_id:userId},{session});
    if(accountState&&Number(accountState.active)!==1)throw new HttpError(403,"This account is unavailable.");
    if(d.action==="create-business"){
      if(await c.memberships.findOne({user_id:userId},{session}))throw new HttpError(409,"You already have a business workspace.");
      const businessId=randomUUID(),business:Business={id:businessId,name:d.name,owner_id:userId,timezone:"Asia/Kolkata",grace_minutes:10,retention_days:365,created_at:now};
      await c.businesses.insertOne({_id:businessId,...business},{session});await c.memberships.insertOne({_id:`${businessId}:${userId}`,business_id:businessId,user_id:userId,role:"owner"},{session});
      await audit(c,session,{business,role:"owner"},userId,d.action,businessId,null,{name:d.name});return {message:"Your business workspace is ready."};
    }
    const s=await scope(userId,c,session);
    // Shared business writes serialize shift reservations, corrections, and attendance.
    await c.businesses.updateOne({id:s.business.id},{$inc:{lock_version:1}},{session});
    const worker=async(workerId:string)=>{const row=await c.workers.findOne({id:workerId,business_id:s.business.id},{session});if(!row)throw new HttpError(404,"Worker not found.");return row;};
    const shift=async(shiftId:string)=>{const row=await c.shifts.findOne({id:shiftId,business_id:s.business.id,...(s.workerId?{worker_id:s.workerId}:{})},{session});if(!row)throw new HttpError(404,"Shift not found.");return row;};
    const overlap=async(workerId:string,start:string,end:string,excludeId?:string)=>c.shifts.findOne({worker_id:workerId,status:{$ne:"cancelled"},starts_at:{$lt:end},ends_at:{$gt:start},...(excludeId?{id:{$ne:excludeId}}:{})},{session});
    if(d.action==="add-worker"){
      manager(s);const workerId=randomUUID(),email=d.email.toLowerCase(),linked=email?await c.users.findOne({email},{session}):null;
      if(email&&await c.workers.findOne({business_id:s.business.id,email,active:1},{session}))throw new HttpError(409,"This worker is already active in your workspace.");
      await c.workers.insertOne({_id:workerId,id:workerId,business_id:s.business.id,user_id:linked?.id||null,name:d.name,email,department:d.department,service:d.service,active:1,created_at:now},{session});await audit(c,session,s,userId,d.action,workerId,null,d);return {message:linked?"Worker added and their account linked.":"Worker added. Add an existing account email to enable self check-in."};
    }
    if(d.action==="update-worker"){
      manager(s);const before=await worker(d.workerId),email=d.email.toLowerCase(),linked=email?await c.users.findOne({email},{session}):null;
      if(d.active&&email&&await c.workers.findOne({business_id:s.business.id,email,active:1,id:{$ne:d.workerId}},{session}))throw new HttpError(409,"This email belongs to another active worker in your workspace.");
      await c.workers.updateOne({id:d.workerId,business_id:s.business.id},{$set:{name:d.name,department:d.department,service:d.service,active:d.active?1:0,email,user_id:linked?.id||null}},{session});await audit(c,session,s,userId,d.action,d.workerId,publicRecord(before),d);return {message:"Worker updated. Attendance history is preserved."};
    }
    if(d.action==="create-shift"){
      manager(s);const w=await worker(d.workerId);if(!w.active)throw new HttpError(400,"Reactivate this worker before scheduling a shift.");await c.workers.updateOne({id:w.id},{$inc:{lock_version:1}},{session});
      const start=localTimeToUtc(d.start,s.business.timezone),end=localTimeToUtc(d.end,s.business.timezone);if(end<=start||Date.parse(end)-Date.parse(start)>24*3600000)throw new HttpError(400,"Shifts must be between one minute and 24 hours.");
      if(await overlap(w.id,start,end))throw new HttpError(409,"This worker already has an overlapping shift.");const shiftId=randomUUID();
      await c.shifts.insertOne({_id:shiftId,id:shiftId,business_id:s.business.id,worker_id:w.id,starts_at:start,ends_at:end,notes:d.notes,status:"scheduled",created_at:now},{session});await audit(c,session,s,userId,d.action,shiftId,null,d);return {message:"Shift scheduled."};
    }
    if(d.action==="shift-status"){
      manager(s);const sh=await shift(d.shiftId);if(await c.attendance.findOne({shift_id:sh.id},{session}))throw new HttpError(409,"A shift with attendance cannot be cancelled or marked on leave.");
      if(d.status!=="cancelled"&&await overlap(sh.worker_id,sh.starts_at,sh.ends_at,sh.id))throw new HttpError(409,"This worker already has an overlapping shift.");
      await c.shifts.updateOne({id:sh.id,business_id:s.business.id},{$set:{status:d.status}},{session});await audit(c,session,s,userId,d.action,sh.id,{status:sh.status},{status:d.status});return {message:"Shift updated."};
    }
    if(d.action==="check-in"||d.action==="check-out"){
      const sh=await shift(d.shiftId);if(sh.status!=="scheduled")throw new HttpError(409,"This shift is not scheduled for work.");const attendance=await c.attendance.findOne({shift_id:sh.id},{session});
      if(d.action==="check-in"){
        if(attendance)throw new HttpError(409,"This shift already has a check-in.");if(!(await worker(sh.worker_id)).active)throw new HttpError(409,"This team member is archived. Reactivate them before check-in.");
        if(Date.parse(now)<Date.parse(sh.starts_at)-30*60000||Date.parse(now)>Date.parse(sh.ends_at))throw new HttpError(409,"Check-in opens 30 minutes before the shift and closes at its end. Request a correction for a missed entry.");
        const late=Date.parse(now)>Date.parse(sh.starts_at)+s.business.grace_minutes*60000,id=randomUUID();await c.attendance.insertOne({_id:id,id,shift_id:sh.id,check_in:now,check_out:null,status:late?"late":"present",recorded_by:userId,updated_at:now},{session});await audit(c,session,s,userId,d.action,sh.id,null,{check_in:now,recordedBy:userId});return {message:late?"Checked in. Arrival recorded as late.":"Checked in. Have a good shift."};
      }
      if(!attendance)throw new HttpError(409,"Check in before checking out.");if(attendance.check_out)throw new HttpError(409,"This shift is already checked out.");if(now<=attendance.check_in)throw new HttpError(409,"Check-out must be after check-in.");
      const changed=await c.attendance.updateOne({id:attendance.id,check_out:null},{$set:{check_out:now,updated_at:now}},{session});if(!changed.matchedCount)throw new HttpError(409,"This shift is already checked out.");
      await audit(c,session,s,userId,d.action,sh.id,publicRecord(attendance),{...publicRecord(attendance),check_out:now});return {message:"Checked out. Working hours have been recorded."};
    }
    if(d.action==="request-correction"){
      const sh=await shift(d.shiftId);if(sh.status!=="scheduled")throw new HttpError(409,"Only scheduled shifts can have attendance corrections.");const start=localTimeToUtc(d.start,s.business.timezone),end=d.end?localTimeToUtc(d.end,s.business.timezone):null;
      if(Date.parse(start)>Date.now()||(end&&Date.parse(end)>Date.now())||(end&&end<=start)||(end&&Date.parse(end)-Date.parse(start)>24*3600000))throw new HttpError(400,"Correction times must be in the past, in order, and within 24 hours.");
      if(localDate(start,s.business.timezone)!==localDate(sh.starts_at,s.business.timezone))throw new HttpError(400,"Check-in must be on the scheduled shift date.");if(await c.corrections.findOne({shift_id:sh.id,status:"pending"},{session}))throw new HttpError(409,"A correction is already awaiting review for this shift.");
      const correctionId=randomUUID();await c.corrections.insertOne({_id:correctionId,id:correctionId,shift_id:sh.id,requested_by:userId,check_in:start,check_out:end,reason:d.reason,status:"pending",reviewed_by:null,reviewed_at:null,created_at:now},{session});await audit(c,session,s,userId,d.action,sh.id,null,{start,end,reason:d.reason});return {message:"Correction submitted for manager review."};
    }
    if(d.action==="review-correction"){
      manager(s);const correction=await c.corrections.findOne({id:d.correctionId},{session});if(!correction)throw new HttpError(404,"Correction not found.");const sh=await c.shifts.findOne({id:correction.shift_id,business_id:s.business.id},{session});if(!sh)throw new HttpError(404,"Correction not found.");if(correction.status!=="pending")throw new HttpError(409,"This correction has already been reviewed.");
      if(d.decision==="approved"&&sh.status!=="scheduled")throw new HttpError(409,"Restore this shift to scheduled before approving its correction.");
      const before=await c.attendance.findOne({shift_id:sh.id},{session});if(d.decision==="approved"){const changes={check_in:correction.check_in,check_out:correction.check_out,status:"corrected" as const,recorded_by:userId,updated_at:now};if(before)await c.attendance.updateOne({id:before.id},{$set:changes},{session});else{const id=randomUUID();await c.attendance.insertOne({_id:id,id,shift_id:sh.id,...changes},{session});}}
      await c.corrections.updateOne({id:correction.id,status:"pending"},{$set:{status:d.decision,reviewed_by:userId,reviewed_at:now}},{session});await audit(c,session,s,userId,`correction-${d.decision}`,sh.id,before?publicRecord(before):null,publicRecord(correction));return {message:`Correction ${d.decision}. The original record remains in the audit history.`};
    }
    if(d.action==="settings"){
      manager(s);try{new Intl.DateTimeFormat("en",{timeZone:d.timezone});}catch{throw new HttpError(400,"Choose a valid IANA timezone.");}
      await c.businesses.updateOne({id:s.business.id},{$set:{name:d.name,timezone:d.timezone,grace_minutes:d.graceMinutes,retention_days:d.retentionDays}},{session});await audit(c,session,s,userId,d.action,s.business.id,s.business,d);return {message:"Business settings saved."};
    }
    if(d.action==="create-contract"){
      manager(s);await worker(d.workerId);if(d.end<d.start)throw new HttpError(400,"The end date must follow the start date.");const contractId=randomUUID();await c.contracts.insertOne({_id:contractId,id:contractId,business_id:s.business.id,worker_id:d.workerId,title:d.title,starts_on:d.start,ends_on:d.end,monthly_amount:d.monthlyAmount,scope:d.scope,cancellation_terms:d.cancellationTerms,status:"active",created_at:now},{session});await audit(c,session,s,userId,d.action,contractId,null,d);return {message:"Recurring arrangement saved. Payments are tracked separately; no charge was made."};
    }
    if(d.action==="end-contract"){
      manager(s);const contract=await c.contracts.findOne({id:d.contractId,business_id:s.business.id},{session});if(!contract)throw new HttpError(404,"Arrangement not found.");await c.contracts.updateOne({id:contract.id},{$set:{status:"ended"}},{session});await audit(c,session,s,userId,d.action,contract.id,publicRecord(contract),{status:"ended"});return {message:"Arrangement ended. The record has been retained."};
    }
    throw new HttpError(400,"Unknown action.");
  });}catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code===11000)throw new HttpError(409,"This record already exists or changed during your request. Refresh the workspace and try again.");throw error;}
}
export function csvCell(value:unknown){const text=String(value??"");return `"${(/^(?:\s*[=+@\-]|[\t\r\n])/.test(text)?"'":"")+text.replace(/"/g,'""')}"`;}
export function workforceCsv(snapshot:WorkforceSnapshot){
  const rows:unknown[][]=[["Worker","Department","Shift start (UTC)","Shift end (UTC)","Check in (UTC)","Check out (UTC)","Scheduled hours","Worked hours","Status","Display timezone"]];
  for(const s of snapshot.shifts)rows.push([s.name,s.department,s.starts_at,s.ends_at,s.check_in,s.check_out,((Date.parse(s.ends_at)-Date.parse(s.starts_at))/3600000).toFixed(2),workedHours(s).toFixed(2),attendanceLabel(s),snapshot.business?.timezone]);return "\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
}
