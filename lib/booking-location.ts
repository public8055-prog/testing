import {randomUUID} from "node:crypto";
import type {ClientSession,Document} from "mongodb";
import {z} from "zod";
import {getMongoDb,mongoCollection,withMongoTransaction} from "./mongo";
import {HttpError} from "./http";
import {ADMIN_ROLES,isAccountActive,isAdminRole} from "./roles";
import {publishServiceUpdate} from "./service-operations";
import type {BookingLocation,LocationPoint,SharedPosition} from "./location-types";

type Actor={id:string;role:string};
type Source="catalog"|"provider";
type Row=Document&{_id:string};
export type BookingLocationShare=Row&{session_id:string|null;sequence:number;point?:LocationPoint;point_session_id?:string;sharing:boolean;sharing_until:Date;expires_at:Date;stopped_reason?:string|null};
type Share=BookingLocationShare;
export const LOCATION_RETENTION_DAYS=7,LOCATION_SESSION_MS=4*60*60*1000;
const terminal=new Set(["cancelled","completed","no_show"]),ready=new Map<string,Promise<void>>();
const coordinate=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)}).strict();
const gpsPoint=coordinate.extend({accuracy:z.number().finite().min(0).max(100000),observedAt:z.string().datetime()}).strict();
const consent=z.literal(true,{error:"Confirm location sharing before continuing."});
export const locationMutationSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("site"),address:z.string().trim().min(10).max(500),landmark:z.string().trim().max(200),pin:coordinate.nullable(),version:z.number().int().nonnegative(),consent}).strict(),
  z.object({action:z.literal("start"),sessionId:z.string().uuid(),consent}).strict(),
  z.object({action:z.literal("position"),sessionId:z.string().uuid(),sequence:z.number().int().positive().max(1000000),point:gpsPoint}).strict(),
  z.object({action:z.literal("stop"),sessionId:z.string().uuid(),reason:z.enum(["stopped","page_closed","permission_denied","offline","session_ended"]),finalPosition:z.object({sequence:z.number().int().positive().max(1000000),point:gpsPoint}).strict().optional()}).strict(),
  z.object({action:z.literal("forget")}).strict(),
]);
export async function ensureBookingLocations(){
  const db=await getMongoDb();if(!ready.has(db.databaseName))ready.set(db.databaseName,(async()=>{
    await db.collection("booking_location_shares").createIndex({expires_at:1},{expireAfterSeconds:0});
    await db.collection("booking_location_shares").createIndex({source:1,booking_id:1,user_id:1},{unique:true});
    await db.collection("booking_location_access").createIndex({expires_at:1},{expireAfterSeconds:0});
  })().catch(error=>{ready.delete(db.databaseName);throw error;}));return ready.get(db.databaseName)!;
}
function reference(source:string,id:string):asserts source is Source{
  if(!["catalog","provider"].includes(source)||!id||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new HttpError(404,"Service location not found.");
}
async function context(actor:Actor,source:Source,id:string,session?:ClientSession,writing=false,allowTerminal=false){
  const users=await mongoCollection<Row>("users");
  const user=writing?await users.findOneAndUpdate({id:actor.id},{$inc:{location_access_version:1}},{session,returnDocument:"after"}):await users.findOne({id:actor.id},{session});
  const state=await(await mongoCollection("platform_account_status")).findOne({user_id:actor.id},{session});
  if(!isAccountActive(user,state))throw new HttpError(401,"Please sign in with an active account.");
  const bookings=await mongoCollection(source==="catalog"?"bookings":"marketplace_bookings");
  const booking=writing?await bookings.findOneAndUpdate({id},{$inc:{location_write_version:1}},{session,returnDocument:"after"}):await bookings.findOne({id},{session});
  if(!booking)throw new HttpError(404,"Service location not found.");
  const tokens=await mongoCollection("service_tokens"),token=writing?await tokens.findOneAndUpdate({_id:`${source}:${id}`},{$inc:{location_write_version:1}},{session,returnDocument:"after"}):await tokens.findOne({_id:`${source}:${id}`},{session});
  const providerId=source==="catalog"?token?.assigned_provider_id:booking.provider_id;
  const provider=providerId?await(await mongoCollection("marketplace_providers")).findOne({id:providerId},{session}):null;
  const customerId=String(source==="catalog"?booking.user_id:booking.customer_id);
  const providerUserId=provider&&Number(provider.active)===1?String(provider.user_id||""):null;
  const assigned=providerUserId===actor.id&&(!token||token.assigned_user_id===actor.id);
  const viewer=customerId===actor.id?"customer":isAdminRole(user!.role)?"admin":assigned?"provider":null;
  if(!viewer||viewer==="provider"&&terminal.has(booking.status)&&!allowTerminal)throw new HttpError(404,"Service location not found.");
  return{booking,token,customerId,providerUserId,provider,viewer};
}
export function sharedPosition(row:Share|null,active:boolean,now=Date.now()):SharedPosition{
  if(!row||row.expires_at.getTime()<=now)return{point:null,state:"not_shared",sharingUntil:null,stoppedReason:null};
  const recent=active&&row.sharing&&row.sharing_until.getTime()>now&&row.point_session_id===row.session_id&&row.point&&now-Date.parse(row.point.receivedAt)<=90000;
  return{point:row.point||null,state:recent?"recent":row.point?"last_known":"not_shared",sharingUntil:row.sharing?row.sharing_until.toISOString():null,stoppedReason:row.stopped_reason||null};
}
export async function readBookingLocation(actor:Actor,source:string,id:string):Promise<BookingLocation>{
  reference(source,id);await ensureBookingLocations();const ctx=await context(actor,source,id),now=new Date();
  const shares=await mongoCollection<Share>("booking_location_shares"),site=await(await mongoCollection("booking_location_sites")).findOne({_id:`${source}:${id}`});
  const [customer,customerPosition,providerPosition]=await Promise.all([
    (await mongoCollection("users")).findOne({id:ctx.customerId},{projection:{name:1}}),
    shares.findOne({source,booking_id:id,user_id:ctx.customerId,expires_at:{$gt:now}}),
    ctx.providerUserId?shares.findOne({source,booking_id:id,user_id:ctx.providerUserId,expires_at:{$gt:now}}):null,
  ]);
  if(ctx.viewer==="admin"){
    const auditId=`${actor.id}:${source}:${id}:${Math.floor(now.getTime()/300000)}`;
    await(await mongoCollection("booking_location_access")).updateOne({_id:auditId},{$setOnInsert:{actor_id:actor.id,action:"location.viewed",source,booking_id:id,created_at:now,expires_at:new Date(now.getTime()+90*86400000)}},{upsert:true});
  }
  const active=!terminal.has(ctx.booking.status),canShare=ctx.viewer!=="admin"&&["confirmed","in_progress"].includes(ctx.booking.status);
  return{source,bookingId:id,status:ctx.booking.status,token:ctx.token?.token||null,viewer:ctx.viewer as BookingLocation["viewer"],address:String(ctx.booking.address||""),landmark:String(site?.landmark||""),sitePin:site?.pin||null,version:Number(site?.version||0),customer:{name:String(customer?.name||ctx.booking.name||"Customer"),location:sharedPosition(customerPosition,active)},provider:ctx.provider?{name:String(ctx.provider.display_name||"Assigned professional"),location:sharedPosition(providerPosition,active)}:null,canEditAddress:ctx.viewer==="customer"&&["pending","confirmed"].includes(ctx.booking.status),canShare,retentionDays:LOCATION_RETENTION_DAYS,serverTime:now.toISOString()};
}
export async function mutateBookingLocation(actor:Actor,source:string,id:string,input:unknown){
  reference(source,id);const parsed=locationMutationSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"Invalid location update.");
  const data=parsed.data;await ensureBookingLocations();let recipients:string[]=[];
  await withMongoTransaction(async session=>{
    const ctx=await context(actor,source,id,session,true,data.action==="stop"||data.action==="forget"),now=new Date();
    recipients=[ctx.customerId,...(ctx.providerUserId?[ctx.providerUserId]:[])];
    if(data.action==="site"){
      if(ctx.viewer!=="customer")throw new HttpError(403,"Only the booking customer can change the service address.");
      if(!["pending","confirmed"].includes(ctx.booking.status))throw new HttpError(409,"The service has started or closed. Contact support to change its address.");
      if(source==="catalog"&&!/\b[1-9]\d{5}\b/.test(data.address))throw new HttpError(400,"Include a valid 6-digit pincode in the service address.");
      const sites=await mongoCollection("booking_location_sites"),key=`${source}:${id}`,previous=await sites.findOne({_id:key},{session});
      if(Number(previous?.version||0)!==data.version)throw new HttpError(409,"The address changed. Refresh before saving again.");
      const record={source,booking_id:id,pin:data.pin,landmark:data.landmark,version:data.version+1,updated_at:now.toISOString(),updated_by:actor.id,consent_version:"service-location-v1"};
      if(previous)await sites.updateOne({_id:key,version:data.version},{$set:record},{session});else await sites.insertOne({_id:key,...record},{session});
      await(await mongoCollection(source==="catalog"?"bookings":"marketplace_bookings")).updateOne({id},{$set:{address:data.address,updated_at:now.toISOString()}},{session});
    }else{
      if(ctx.viewer==="admin")throw new HttpError(403,"Administrators can view shared locations, but cannot impersonate a participant.");
      const shares=await mongoCollection<Share>("booking_location_shares"),key=`${source}:${id}:${actor.id}`;
      if(data.action==="start"){
        if(!["confirmed","in_progress"].includes(ctx.booking.status))throw new HttpError(409,"Live sharing is available for confirmed or ongoing services.");
        const previous=await shares.findOne({_id:key},{session});
        if(previous?.session_id===data.sessionId)return;
        const retained=previous?.point&&previous.expires_at>now;
        await shares.updateOne({_id:key},{$set:{source,booking_id:id,user_id:actor.id,session_id:data.sessionId,sequence:0,sharing:true,sharing_until:new Date(now.getTime()+LOCATION_SESSION_MS),expires_at:retained?previous.expires_at:new Date(now.getTime()+LOCATION_RETENTION_DAYS*86400000),consent_at:now.toISOString(),consent_version:"booking-live-location-v1",stopped_reason:null},...(!retained?{$unset:{point:"" as const,point_session_id:"" as const}}:{})},{upsert:true,session});
      }else if(data.action==="position"){
        if(!["confirmed","in_progress"].includes(ctx.booking.status))throw new HttpError(409,"The service is no longer active. Location sharing has ended.");
        const observed=Date.parse(data.point.observedAt);if(observed<now.getTime()-120000||observed>now.getTime()+30000)throw new HttpError(400,"Use a fresh GPS position with a correct device clock.");
        const result=await shares.updateOne({_id:key,session_id:data.sessionId,sharing:true,sharing_until:{$gt:now},sequence:{$lt:data.sequence},$or:[{point:{$exists:false}},{"point.observedAt":{$lt:data.point.observedAt}},{point_session_id:{$ne:data.sessionId}}]},{$set:{point:{...data.point,receivedAt:now.toISOString()},point_session_id:data.sessionId,sequence:data.sequence,expires_at:new Date(now.getTime()+LOCATION_RETENTION_DAYS*86400000)}},{session});
        if(!result.matchedCount)throw new HttpError(409,"This sharing session ended or a newer update was received. Start sharing again if needed.");
      }else if(data.action==="stop"){
        const previous=await shares.findOne({_id:key,session_id:data.sessionId},{session}),last=data.finalPosition;
        const finalPoint=previous&&previous.sharing&&previous.sharing_until>now&&last&&last.sequence>previous.sequence&&Date.parse(last.point.observedAt)>=now.getTime()-120000&&Date.parse(last.point.observedAt)<=now.getTime()+30000&&(!previous.point||last.point.observedAt>previous.point.observedAt)?{point:{...last.point,receivedAt:now.toISOString()},point_session_id:data.sessionId,sequence:last.sequence,expires_at:new Date(now.getTime()+LOCATION_RETENTION_DAYS*86400000)}:{};
        const result=await shares.updateOne({_id:key,session_id:data.sessionId},{$set:{sharing:false,stopped_reason:data.reason,...finalPoint}},{session});
        if(!result.matchedCount)throw new HttpError(409,"A different sharing session is active. Its location was not changed.");
        const recipient=ctx.viewer==="customer"?ctx.providerUserId:ctx.customerId;
        if(previous?.sharing&&(previous.point||"point"in finalPoint)&&recipient&&recipient!==actor.id&&!terminal.has(ctx.booking.status)){
          const notificationId=randomUUID();
          await(await mongoCollection("customer_notifications")).insertOne({_id:notificationId,user_id:recipient,title:"Last shared location saved",message:`${ctx.viewer==="customer"?"Your customer":"Your professional"} ended live location sharing. Open the booking location to see their last saved point, its timestamp and the service address before travelling.`,href:`/locations/${source}/${id}`,token:ctx.token?.token||null,token_id:ctx.token?._id||null,created_at:now.toISOString(),read_at:null,popup_dismissed_at:null,actor_id:actor.id},{session});
        }
      }else{
        await shares.updateOne({_id:key},{$set:{sharing:false,session_id:null,stopped_reason:"removed"},$unset:{point:"",point_session_id:""}},{session});
      }
    }
    if(data.action!=="position"){const auditId=randomUUID();await(await mongoCollection("platform_audit")).insertOne({_id:auditId,id:auditId,actor_id:actor.id,action:`location.${data.action}`,target_id:id,details:JSON.stringify({source}),created_at:now.toISOString()},{session});}
  });
  // Coordinates stay in MongoDB; live transports carry only authenticated refresh hints.
  try{const admins=await(await mongoCollection("users")).find({role:{$in:[...ADMIN_ROLES]}},{projection:{id:1}}).toArray();await Promise.all([...new Set([...recipients,...admins.map(admin=>String(admin.id))])].map(publishServiceUpdate));}catch{/* Visible-page polling reads the committed position if transport is unavailable. */}
  return{ok:true};
}
