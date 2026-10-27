import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { mongoCollection } from "./mongo";
import { ADMIN_ROLES,isAccountActive } from "./roles";
import { queueScopeId,type QueueNumber } from "./queue-numbering";
import { HttpError } from "./http";
import type { ServiceToken } from "./service-operations";
type ReschedulableToken = ServiceToken & { token_history?: { token:string;queue_day:string|null;sequence:number|null;changed_at:string }[] };
/** All start paths serialize on the assigned person, across service/day queues. */
export async function assertQueueProviderAvailable(token:{_id:string;assigned_provider_id?:string|null;assigned_user_id?:string|null},session:ClientSession){
  if(!token.assigned_user_id||!token.assigned_provider_id)throw new HttpError(409,"Assign a provider before starting service.");
  const provider=await(await mongoCollection("marketplace_providers")).findOneAndUpdate({id:token.assigned_provider_id,user_id:token.assigned_user_id,active:1},{$inc:{queue_version:1}},{session});
  const user=await(await mongoCollection("users")).findOneAndUpdate({id:token.assigned_user_id},{$inc:{queue_assignment_version:1}},{session,returnDocument:"after"});
  if(!provider||!isAccountActive(user,await(await mongoCollection("platform_account_status")).findOne({user_id:token.assigned_user_id},{session})))throw new HttpError(409,"The assigned provider account is unavailable.");
  if(await(await mongoCollection("service_tokens")).findOne({_id:{$ne:token._id},assigned_user_id:token.assigned_user_id,queue_status:"in_service"},{session}))throw new HttpError(409,"This professional is already serving another appointment.");
}
/** Keep older booking controls on the same queue record; caller owns transaction/auth. */
export async function syncQueueBookingStatus(source:"catalog"|"provider",bookingId:string,status:string,actorId:string,session:ClientSession){
  const next=({in_progress:"in_service",completed:"completed",cancelled:"cancelled"} as Record<string,string>)[status];if(!next)return;
  const tokens=await mongoCollection("service_tokens"),token=await tokens.findOne({_id:`${source}:${bookingId}`,queue_status:{$exists:true}},{session});
  if(!token||token.queue_status===next||token.queue_status==="no_show"&&next==="cancelled")return;
  if(next==="in_service")await assertQueueProviderAvailable(token,session);
  await(await mongoCollection("queue_counters")).updateOne({_id:queueScopeId(token.service_id,token.queue_day)},{$inc:{version:1}},{session});
  const now=new Date().toISOString(),fields:Record<string,unknown>={queue_status:next};
  if(next==="in_service"){fields.started_at=now;fields.wait_seconds=Math.max(0,Math.round((Date.now()-Date.parse(token.queued_at||token.created_at))/1000));}
  if(next==="completed"){fields.completed_at=now;fields.service_seconds=token.started_at?Math.max(0,Math.round((Date.now()-Date.parse(token.started_at))/1000)):null;}
  await tokens.updateOne({_id:token._id},{$set:fields,$inc:{version:1}},{session});
  await(await mongoCollection("queue_events")).insertOne({_id:randomUUID(),token_id:token._id,service_id:token.service_id,queue_day:token.queue_day,status:next,from:token.queue_status,action:"booking-status",actor_id:actorId,created_at:now},{session});
}
export async function publishQueueBooking(source:"catalog"|"provider",bookingId:string,previousScope?:{serviceId:string;day:string}){
 try{
  const token=await(await mongoCollection("service_tokens")).findOne({_id:`${source}:${bookingId}`});if(!token)return;
  const watching=token.service_id?await(await mongoCollection("service_tokens")).find({$or:[{service_id:token.service_id,queue_day:token.queue_day},...(previousScope?[{service_id:previousScope.serviceId,queue_day:previousScope.day}]:[])],queue_status:{$in:["waiting","called","in_service"]}},{projection:{customer_id:1,assigned_user_id:1}}).toArray():[];
  const admins=await(await mongoCollection("users")).find({role:{$in:[...ADMIN_ROLES]}},{projection:{id:1}}).toArray();
  const {publishServiceUpdate}=await import("./service-operations");
  await Promise.all([...new Set([token.customer_id,token.assigned_user_id,...watching.flatMap(row=>[row.customer_id,row.assigned_user_id]),...admins.map(row=>row.id)].filter(Boolean))].map(id=>publishServiceUpdate(String(id))));
 }catch{/* The booking is already durable. Reconnect and manual refresh read the same records. */}
}
/** Rescheduling moves queue membership atomically while retaining previous references. */
export async function rescheduleQueueInSession(bookingId:string,queue:QueueNumber,serviceIds:string[],actorId:string,session:ClientSession){
  const tokens=await mongoCollection<ReschedulableToken>("service_tokens"),token=await tokens.findOne({_id:`catalog:${bookingId}`},{session});
  if(!token)throw new HttpError(409,"The booking token is unavailable. Refresh before rescheduling.");
  if(token.queue_status&&!['waiting','called'].includes(token.queue_status))throw new HttpError(409,"This queue appointment can no longer be rescheduled.");
  const keys=[...new Set([queueScopeId(queue.service_id,queue.queue_day),...(token.service_id&&token.queue_day?[queueScopeId(token.service_id,token.queue_day)]:[])])].sort();
  for(const key of keys)await(await mongoCollection("queue_counters")).updateOne({_id:key},{$inc:{version:1}},{session});
  const now=new Date().toISOString(),nextLabel=token.token.startsWith("UK-")?token.token:queue.token;
  const previous={token:token.token,queue_day:token.queue_day||null,sequence:token.sequence||null,changed_at:now};
  await tokens.updateOne({_id:token._id},{$set:{...queue,token:nextLabel,service_ids:serviceIds,sort_order:queue.sequence,queue_status:"waiting",queued_at:now,called_at:null,started_at:null,completed_at:null},$unset:{wait_seconds:"",service_seconds:""},$inc:{version:1},$push:{token_history:previous}},{session});
  await(await mongoCollection("queue_events")).insertOne({_id:randomUUID(),token_id:token._id,service_id:queue.service_id,queue_day:queue.queue_day,status:"rescheduled",from:token.queue_status||"waiting",previous_token:previous.token,previous_day:previous.queue_day,token:nextLabel,actor_id:actorId,created_at:now},{session});
  return token.service_id&&token.queue_day?{serviceId:String(token.service_id),day:String(token.queue_day)}:undefined;
}
