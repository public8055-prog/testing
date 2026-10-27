import { createHash } from "node:crypto";
import { mongoCollection, getMongoDb, withMongoTransaction } from "./mongo";
import { getRedis } from "./redis";
import { HttpError } from "./http";

export type QueueNumber = { service_id:string; queue_day:string; sequence:number; token:string };
const allocationValue=(row:{service_id:unknown;queue_day:unknown;sequence:unknown;token:unknown}):QueueNumber=>({service_id:String(row.service_id),queue_day:String(row.queue_day),sequence:Number(row.sequence),token:String(row.token)});
const ready=new Map<string,Promise<void>>();
export const queueScopeId=(serviceId:string,day:string)=>createHash("sha256").update(`${serviceId}\0${day}`).digest("hex");
export async function ensureQueueNumbering(){
  const db=await getMongoDb();
  if(!ready.has(db.databaseName))ready.set(db.databaseName,(async()=>{
    await db.collection("queue_allocations").createIndex({service_id:1,queue_day:1,sequence:1},{unique:true});
    await db.collection("service_tokens").createIndex({service_id:1,queue_day:1,sequence:1},{unique:true,partialFilterExpression:{sequence:{$type:"number"}}});
    await db.collection("service_tokens").createIndex({assigned_user_id:1,queue_day:1,queue_status:1});
    await db.collection("queue_events").createIndex({token_id:1,created_at:1});
  })().catch(error=>{ready.delete(db.databaseName);throw error;}));
  await ready.get(db.databaseName);
}
const increment=`local floor=tonumber(ARGV[1]); local current=tonumber(redis.call('GET',KEYS[1]) or '0'); if current<floor then redis.call('SET',KEYS[1],floor) end; local number=redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],172800); return number`;
/** Redis supplies an atomic candidate; Mongo reserves it durably before a booking can use it.
 * The Mongo counter serializes candidates arriving out of order or after Redis loses its keys.
 * Unused reservations intentionally leave gaps; a number is never recycled. No external calls
 * occur in a booking transaction, and replaying the same booking allocation is harmless. */
export async function prepareQueueNumber(source:"catalog"|"provider",bookingId:string,serviceId:string,day:string):Promise<QueueNumber>{
  if(!serviceId||serviceId.length>2500||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new HttpError(400,"Invalid service queue.");
  await ensureQueueNumbering();
  const allocationId=`${source}:${bookingId}`,allocations=await mongoCollection("queue_allocations"),counters=await mongoCollection("queue_counters"),scope=queueScopeId(serviceId,day);
  const existing=await allocations.findOne({_id:allocationId});
  if(existing){if(existing.service_id!==serviceId||existing.queue_day!==day)throw new HttpError(409,"This booking already belongs to another queue.");return allocationValue(existing as typeof existing&{service_id:string;queue_day:string;sequence:number;token:string});}
  try{await counters.updateOne({_id:scope},{$setOnInsert:{service_id:serviceId,queue_day:day,value:0,version:0}},{upsert:true});}
  catch(error){if(!(error&&typeof error==="object"&&"code"in error&&error.code===11000))throw error;}
  const floor=Number((await counters.findOne({_id:scope}))?.value||0);
  let candidate:number;
  try{candidate=Number(await(await getRedis()).eval(increment,{keys:[`${process.env.REDIS_KEY_PREFIX||`urbankare:${process.env.MONGODB_DB||"urbankare"}`}:queue:${scope}`],arguments:[String(floor)]}));}
  catch{throw new HttpError(503,"Queue numbering is temporarily unavailable. Please retry your booking.",5);}
  if(!Number.isSafeInteger(candidate)||candidate<1)throw new HttpError(503,"Queue numbering is temporarily unavailable.");
  return withMongoTransaction(async session=>{
    const counter=await counters.findOneAndUpdate({_id:scope},{$inc:{allocation_version:1}},{session,returnDocument:"after"});
    const replay=await allocations.findOne({_id:allocationId},{session});
    if(replay){if(replay.service_id!==serviceId||replay.queue_day!==day)throw new HttpError(409,"This booking already belongs to another queue.");return allocationValue(replay as typeof replay&{service_id:string;queue_day:string;sequence:number;token:string});}
    const sequence=Math.max(candidate,Number(counter?.value||0)+1);
    const value={service_id:serviceId,queue_day:day,sequence,token:`TKN-${day.replaceAll("-","")}-${String(sequence).padStart(4,"0")}`};
    await counters.updateOne({_id:scope},{$set:{value:sequence}},{session});
    await allocations.insertOne({_id:allocationId,...value,created_at:new Date().toISOString()},{session});
    return value;
  });
}
