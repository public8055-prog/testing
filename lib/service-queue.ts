import { randomUUID } from "node:crypto";
import type { ClientSession,Document } from "mongodb";
import { z } from "zod";
import { mongoCollection,withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { isAdminRole,isAccountActive } from "./roles";
import { ensureQueueNumbering,prepareQueueNumber,queueScopeId } from "./queue-numbering";
import { ensureOperations,publishServiceUpdate,transactionAdmin,transitionTrackedBookingInSession,type ServiceToken } from "./service-operations";
import { requestBookingRefund } from "./refunds";
import { parsePayload } from "./db";
import { publishQueueBooking,assertQueueProviderAvailable } from "./queue-state";

export const QUEUE_STATUSES=["waiting","called","in_service","completed","cancelled","no_show"] as const;
type QueueStatus=typeof QUEUE_STATUSES[number];
type Actor={id:string;role:string};
export type QueueEntry={tokenId:string;token:string;source:string;bookingId:string;serviceId:string;day:string;sequence:number;status:QueueStatus;version:number;title:string;customerName:string;providerName:string|null;assignedProviderId:string|null;position:number;tokensAhead:number;estimatedWaitMinutes:number;currentServing:string[];queuedAt:string;calledAt:string|null;startedAt:string|null;completedAt:string|null;timeline:{status:string;createdAt:string}[]};
export type QueueBoard={entries:QueueEntry[];queues:{serviceId:string;day:string;title:string;version:number;waiting:number;currentServing:string[]}[];providers:{id:string;name:string}[];metrics:{waiting:number;inService:number;completed:number;averageWaitMinutes:number|null};limited:boolean};
const queueLabel=(value:string)=>value.replaceAll("_"," ");
const terminal=["completed","cancelled","no_show"];

async function actorRecord(actor:Actor,session?:ClientSession){
  const users=await mongoCollection("users");
  const user=session?await users.findOneAndUpdate({id:actor.id},{$inc:{queue_actor_version:1}},{session,returnDocument:"after"}):await users.findOne({id:actor.id});
  const state=await(await mongoCollection("platform_account_status")).findOne({user_id:actor.id},{session});
  if(!isAccountActive(user,state))throw new HttpError(403,"This account is unavailable.");
  return user!;
}
async function isAdministrator(actor:Actor,session?:ClientSession){const user=await actorRecord(actor,session);return isAdminRole(actor.role)&&isAdminRole(user.role);}

/** Enroll imported tokens without changing their historical public references. */
export async function enrollLegacyToken(token:ServiceToken){
  if(token.queue_status)return token;
  const booking=await(await mongoCollection(token.source==="catalog"?"bookings":"marketplace_bookings")).findOne({id:token.booking_id});
  if(!booking)return token;
  const items=token.source==="catalog"?parsePayload<{slug:string;durationMin?:number;qty:number}[]>(booking.items):[];
  const ids=token.source==="catalog"?items.map(item=>item.slug).sort():[String(booking.provider_id)];
  const serviceId=`${token.source}:${ids.join("+")||"legacy"}`,day=token.source==="catalog"?String(booking.date):String(booking.starts_at).slice(0,10);
  const number=await prepareQueueNumber(token.source,token.booking_id,serviceId,day);
  const provider=token.source==="provider"?await(await mongoCollection("marketplace_providers")).findOne({id:booking.provider_id}):null;
  const status=booking.status==="in_progress"?"in_service":terminal.includes(booking.status)?booking.status:"waiting";
  await(await mongoCollection<ServiceToken>("service_tokens")).updateOne({_id:token._id,queue_status:{$exists:false}},{$set:{service_id:serviceId,service_ids:ids,queue_day:day,sequence:number.sequence,sort_order:number.sequence,queue_status:status,assigned_provider_id:provider?.id||null,assigned_user_id:provider?.user_id||null,queued_at:token.created_at,estimated_minutes:token.source==="catalog"?items.reduce((sum,item)=>sum+(item.durationMin||60)*item.qty,0):booking.kind==="hourly"?Number(booking.hours)*60:480}});
  return(await(await mongoCollection<ServiceToken>("service_tokens")).findOne({_id:token._id}))!;
}
export async function backfillServiceQueues(){await ensureOperations();let count=0;for await(const token of(await mongoCollection<ServiceToken>("service_tokens")).find({queue_status:{$exists:false}})){await enrollLegacyToken(token);count++;}return count;}

export async function queueMetricsForToken(token:ServiceToken,activeRows?:ServiceToken[]){
  if(!token.queue_status||!token.service_id||!token.queue_day)return null;
  const tokens=await mongoCollection<ServiceToken>("service_tokens"),scope={service_id:token.service_id,queue_day:token.queue_day};
  const active=activeRows||await tokens.find({...scope,queue_status:{$in:["waiting","called","in_service"]}}).sort({sort_order:1,created_at:1,_id:1}).toArray();
  const current=active.filter(row=>row.queue_status!=="waiting");
  const ahead=active.filter(row=>row._id!==token._id&&(row.queue_status!=="waiting"||Number(row.sort_order||row.sequence)<Number(token.sort_order||token.sequence)));
  const waiting=token.queue_status==="waiting",seconds=Date.now();
  const estimate=waiting?ahead.reduce((sum,row)=>sum+Math.max(0,(row.estimated_minutes||30)-(row.queue_status==="in_service"&&row.started_at?(seconds-Date.parse(row.started_at))/60000:0)),0):0;
  return{status:token.queue_status,sequence:token.sequence,serviceId:token.service_id,day:token.queue_day,position:waiting?ahead.length+1:0,tokensAhead:waiting?ahead.length:0,estimatedWaitMinutes:Math.ceil(estimate),currentServing:current.map(row=>row.token)};
}
async function entry(token:ServiceToken,activeRows?:ServiceToken[]):Promise<QueueEntry|null>{
  const booking=await(await mongoCollection(token.source==="catalog"?"bookings":"marketplace_bookings")).findOne({id:token.booking_id});if(!booking)return null;
  const [customer,provider,timeline,metrics]=await Promise.all([
    (await mongoCollection("users")).findOne({id:token.customer_id},{projection:{name:1}}),
    token.assigned_provider_id?(await mongoCollection("marketplace_providers")).findOne({id:token.assigned_provider_id},{projection:{display_name:1}}):null,
    (await mongoCollection("queue_events")).find({token_id:token._id}).sort({created_at:1}).limit(100).toArray(),queueMetricsForToken(token,activeRows),
  ]);
  if(!metrics)return null;
  const title=token.source==="catalog"?parsePayload<{title:string}[]>(booking.items).map(item=>item.title).join(", "):`${provider?.display_name||"Professional"} · ${String(booking.kind).replaceAll("_"," ")}`;
  return{tokenId:token._id,token:token.token,source:token.source,bookingId:token.booking_id,serviceId:token.service_id!,day:token.queue_day!,sequence:token.sequence!,status:token.queue_status as QueueStatus,version:token.version,title,customerName:customer?.name||booking.name||"Customer",providerName:provider?.display_name||null,assignedProviderId:token.assigned_provider_id||null,position:metrics.position,tokensAhead:metrics.tokensAhead,estimatedWaitMinutes:metrics.estimatedWaitMinutes,currentServing:metrics.currentServing,queuedAt:token.queued_at||token.created_at,calledAt:token.called_at||null,startedAt:token.started_at||null,completedAt:token.completed_at||null,timeline:timeline.map(row=>({status:row.status,createdAt:row.created_at}))};
}
export async function listQueue(actor:Actor,options:{serviceId?:string;day?:string;provider?:boolean;status?:"in_service"}={}):Promise<QueueBoard>{
  await ensureOperations();const admin=await isAdministrator(actor);
  if(!options.provider&&!admin)throw new HttpError(403,"Administrator access required.");
  const day=options.day||new Date(Date.now()+19800000).toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new HttpError(400,"Choose a valid queue day.");
  const filter:Document={...(options.status&&!options.day?{}:{queue_day:day}),...(options.status?{queue_status:options.status}:{}),...(options.serviceId?{service_id:options.serviceId}:{}),...(options.provider?{assigned_user_id:actor.id}:{})};
  const tokens=await(await mongoCollection<ServiceToken>("service_tokens")).find(filter).sort({service_id:1,sort_order:1}).limit(301).toArray();
  const scopes=[...new Map(tokens.map(row=>[queueScopeId(row.service_id!,row.queue_day!),{service_id:row.service_id,queue_day:row.queue_day}])).values()];
  const activeRows=scopes.length?await(await mongoCollection<ServiceToken>("service_tokens")).find({$or:scopes,queue_status:{$in:["waiting","called","in_service"]}}).sort({sort_order:1,created_at:1,_id:1}).toArray():[];
  const activeByService=new Map<string,ServiceToken[]>();for(const row of activeRows){const key=queueScopeId(row.service_id!,row.queue_day!),group=activeByService.get(key)||[];group.push(row);activeByService.set(key,group);}
  const entries:QueueEntry[]=[];for(let offset=0;offset<Math.min(tokens.length,300);offset+=20){const batch=await Promise.all(tokens.slice(offset,Math.min(offset+20,300)).map(token=>entry(token,activeByService.get(queueScopeId(token.service_id!,token.queue_day!))||[])));entries.push(...batch.filter((row):row is QueueEntry=>Boolean(row)));}
  const queues=[];
  for(const scope of scopes){
    const serviceId=scope.service_id!,queueDay=scope.queue_day!,key=queueScopeId(serviceId,queueDay),rows=entries.filter(row=>row.serviceId===serviceId&&row.day===queueDay);if(!rows.length)continue;
    const counter=await(await mongoCollection("queue_counters")).findOne({_id:key}),active=activeByService.get(key)||[];
    queues.push({serviceId,day:queueDay,title:rows[0].title,version:Number(counter?.version||0),waiting:active.filter(row=>row.queue_status==="waiting").length,currentServing:active.filter(row=>["called","in_service"].includes(row.queue_status||"")).map(row=>row.token)});
  }
  const completed=tokens.filter(row=>row.queue_status==="completed"),waits=completed.map(row=>Number(row.wait_seconds)).filter(Number.isFinite);
  const providers=admin&&!options.provider?await(await mongoCollection("marketplace_providers")).find({active:1,user_id:{$type:"string"}},{projection:{id:1,display_name:1}}).sort({display_name:1}).limit(500).toArray():[];
  return{entries,queues,providers:providers.map(row=>({id:row.id,name:row.display_name})),metrics:{waiting:entries.filter(row=>row.status==="waiting").length,inService:entries.filter(row=>row.status==="in_service").length,completed:completed.length,averageWaitMinutes:waits.length?Math.round(waits.reduce((sum,value)=>sum+value,0)/waits.length/60):null},limited:tokens.length>300};
}
const id=z.string().min(1).max(200),version=z.number().int().nonnegative();
export const queueActionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("call-next"),serviceId:z.string().min(1).max(2500),day:z.iso.date(),version}),
  z.object({action:z.enum(["call","skip","start","complete","cancel","no-show"]),tokenId:id,version}),
  z.object({action:z.literal("assign"),tokenId:id,version,providerId:z.string().uuid()}),
]);
export async function mutateQueue(actor:Actor,input:unknown){
  const parsed=queueActionSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,"Choose a queue action and its current version.");
  await ensureOperations();await ensureQueueNumbering();const data=parsed.data;
  const result=await withMongoTransaction(async session=>{
    const administrator=await isAdministrator(actor,session);if(administrator)await transactionAdmin(actor,session);
    if(!administrator&&!["start","complete"].includes(data.action))throw new HttpError(403,"Only an administrator can manage the queue.");
    const tokens=await mongoCollection<ServiceToken>("service_tokens"),counters=await mongoCollection("queue_counters");
    let token=data.action==="call-next"?null:await tokens.findOne({_id:data.tokenId,...(!administrator?{assigned_user_id:actor.id}:{})},{session});
    if(data.action!=="call-next"&&!token)throw new HttpError(404,"Assigned service token not found.");
    const serviceId=data.action==="call-next"?data.serviceId:token!.service_id,day=data.action==="call-next"?data.day:token!.queue_day;
    if(!serviceId||!day)throw new HttpError(409,"This historical token must be enrolled before queue changes.");
    const counter=await counters.findOneAndUpdate({_id:queueScopeId(serviceId,day),...(data.action==="call-next"?{version:data.version}:{})},{$inc:{version:1}},{session,returnDocument:"after"});
    if(!counter)throw new HttpError(409,"The queue changed. Refresh before trying again.");
    if(data.action==="call-next")token=await tokens.findOne({service_id:serviceId,queue_day:day,queue_status:"waiting"},{session,sort:{sort_order:1,created_at:1,_id:1}});
    if(!token)throw new HttpError(409,"There are no waiting services in this queue.");
    if(data.action!=="call-next"&&token.version!==data.version)throw new HttpError(409,"This token changed. Refresh before trying again.");
    if(!administrator){const provider=await(await mongoCollection("marketplace_providers")).findOneAndUpdate({id:token.assigned_provider_id,user_id:actor.id,active:1},{$inc:{queue_version:1}},{session});if(!provider)throw new HttpError(403,"This service is not assigned to your active provider account.");}
    const now=new Date().toISOString(),changes:Document={},from=token.queue_status;
    let status=from;const action=data.action;
    if(data.action==="assign"){
      if(terminal.includes(from||"")||from==="in_service")throw new HttpError(409,"Assignment cannot change after service starts.");
      if(token.source==="provider")throw new HttpError(409,"This appointment belongs to the professional originally booked.");
      const provider=await(await mongoCollection("marketplace_providers")).findOneAndUpdate({id:data.providerId,active:1,user_id:{$type:"string"}},{$inc:{queue_version:1}},{session});
      const assignedUser=provider?await(await mongoCollection("users")).findOneAndUpdate({id:provider.user_id},{$inc:{queue_assignment_version:1}},{session,returnDocument:"after"}):null;
      if(!provider||!isAccountActive(assignedUser,await(await mongoCollection("platform_account_status")).findOne({user_id:provider?.user_id||""},{session})))throw new HttpError(400,"Choose an active provider account.");
      const services=await(await mongoCollection("services")).find({slug:{$in:token.service_ids||[]}},{session}).toArray();
      if(services.some(service=>Array.isArray(service.provider_ids)&&service.provider_ids.length&&!service.provider_ids.includes(provider.id)))throw new HttpError(400,"This provider is not linked to every service in this appointment.");
      changes.assigned_provider_id=provider.id;changes.assigned_user_id=provider.user_id;
    }else{
      const allowed:Record<string,string[]>={waiting:["call","call-next","cancel","no-show"],called:["skip","start","cancel","no-show"],in_service:["complete"]};
      if(!allowed[from||""]?.includes(action))throw new HttpError(409,"This queue transition is not allowed.");
      status=action==="call"||action==="call-next"?"called":action==="skip"?"waiting":action==="start"?"in_service":action==="complete"?"completed":action==="no-show"?"no_show":"cancelled";
      if(status==="called"){
        if(await tokens.findOne({service_id:serviceId,queue_day:day,queue_status:{$in:["called","in_service"]},_id:{$ne:token._id}},{session}))throw new HttpError(409,"Finish or skip the current service before calling another.");
        changes.called_at=now;
      }
      if(action==="skip"){const last=await tokens.findOne({service_id:serviceId,queue_day:day},{session,sort:{sort_order:-1}});changes.sort_order=Number(last?.sort_order||0)+1;changes.called_at=null;changes.skipped_count=Number(token.skipped_count||0)+1;}
      if(status==="in_service"){await assertQueueProviderAvailable(token,session);changes.started_at=now;changes.wait_seconds=Math.max(0,Math.round((Date.now()-Date.parse(token.queued_at||token.created_at))/1000));}
      if(status==="completed"){changes.completed_at=now;changes.service_seconds=token.started_at?Math.max(0,Math.round((Date.now()-Date.parse(token.started_at))/1000)):null;}
      if(status!=="waiting")await transitionTrackedBookingInSession(token,status==="called"?"confirmed":status==="in_service"?"in_progress":status==="completed"?"completed":"cancelled",actor.id,session);
      changes.queue_status=status;
    }
    await tokens.updateOne({_id:token._id},{$set:changes,$inc:{version:1}},{session});
    const eventId=randomUUID();await(await mongoCollection("queue_events")).insertOne({_id:eventId,token_id:token._id,service_id:serviceId,queue_day:day,status:action==="assign"?"assigned":status,from,action,actor_id:actor.id,created_at:now},{session});
    await(await mongoCollection("customer_notifications")).insertOne({_id:randomUUID(),user_id:token.customer_id,title:action==="assign"?"Your professional is assigned":"Your queue status changed",message:action==="assign"?`A professional is assigned to ${token.token}.`:`${token.token} is now ${queueLabel(status!)}. Open your timeline for details.`,token:token.token,token_id:token._id,href:`/dashboard/tracking?tokenId=${encodeURIComponent(token._id)}`,created_at:now,read_at:null,popup_dismissed_at:null,actor_id:actor.id},{session});
    await(await mongoCollection("platform_audit")).insertOne({_id:eventId,id:eventId,actor_id:actor.id,action:`queue.${action}`,target_id:token._id,details:JSON.stringify({from,to:status,...changes}),created_at:now},{session});
    return{tokenId:token._id,previousProviderId:token.assigned_user_id,source:token.source,bookingId:token.booking_id,cancelled:status==="cancelled"||status==="no_show"};
  });
  if(result.cancelled&&result.source==="catalog")try{await requestBookingRefund(result.bookingId);}catch{/* Maintenance discovers cancelled paid bookings and retries refunds. */}
  await publishQueueBooking(result.source,result.bookingId);if(result.previousProviderId)await publishServiceUpdate(result.previousProviderId);
  return{ok:true,tokenId:result.tokenId};
}
