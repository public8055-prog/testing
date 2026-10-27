import { createHash, randomUUID } from "node:crypto";
import type { ClientSession, Document, Filter } from "mongodb";
import { z } from "zod";
import { activeCatalogFilter } from "./db";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { ensureMarketplaceCategories, readMarketplaceCategories, type MarketplaceCategory } from "./marketplace-categories";
import { ensureOperations, issueServiceToken } from "./service-operations";
import { prepareQueueNumber } from "./queue-numbering";
import { withDistributedLock } from "./redis";
import { syncQueueBookingStatus,publishQueueBooking } from "./queue-state";
import { isAccountActive } from "./roles";

export const marketplaceCategories = ["Housekeeping", "Home cleaning", "Electricians", "Plumbers", "Carpenters", "Drivers", "Home tutors", "Household support"] as const;
export const marketplaceCategorySlugs: Record<string,string> = {housekeeping:"Housekeeping","home-cleaning":"Home cleaning",electrician:"Electricians",plumbing:"Plumbers",carpentry:"Carpenters",drivers:"Drivers","home-tutors":"Home tutors","household-support":"Household support"};
export type MarketplaceProvider = {
  id:string;user_id:string;display_name:string;category:string;city:string;description:string;skills:string;experience:number;
  hourly_rate:number;daily_rate:number;monthly_rate:number;opening_hour:number;closing_hour:number;active:number;verified:number;
  created_at:string;rating?:number|null;review_count?:number;verification_status?:string;verification_reason?:string;
};
export type MarketplaceBooking = {
  id:string;customer_id:string;provider_id:string;provider_name:string;customer_name:string;kind:"hourly"|"full_day"|"monthly";
  starts_at:string;ends_at:string;status:string;total:number;payment_status:string;requirements:string;address:string;hours:number;created_at:string;
};
export type MarketplaceReview = {id:string;rating:number;body:string;created_at:string;customer_name:string};
type ProviderDocument=MarketplaceProvider&{_id:string;reservation_version?:number;verification_status?:string;verification_reason?:string;reviewer_id?:string|null;reviewed_at?:string|null};
type BookingDocument=Omit<MarketplaceBooking,"provider_name"|"customer_name">&{_id:string;request_key:string;request_hash:string;state_version?:number};
type OccurrenceDocument={_id:string;id:string;booking_id:string;provider_id:string;starts_at:string;ends_at:string};
type ReviewDocument={_id:string;id:string;booking_id:string;provider_id:string;customer_id:string;rating:number;body:string;created_at:string;visible:number};
type EventDocument={_id:string;id:string;booking_id:string;actor_id:string;status:string;created_at:string};
type UserDocument={_id:string;id:string;name:string};
type CategoryDocument={_id:string;slug:string;payload:MarketplaceCategory};
type CustomerLock={_id:string;version:number};

const initialized=new Map<string,Promise<void>>();
export async function ensureMarketplace(){
  await ensureMarketplaceCategories();const db=await getMongoDb();
  if(!initialized.has(db.databaseName))initialized.set(db.databaseName,(async()=>{
    await Promise.all([
      db.collection<ProviderDocument>("marketplace_providers").createIndexes([{key:{id:1},unique:true},{key:{user_id:1},unique:true},{key:{active:1,category:1,hourly_rate:1}}]),
      db.collection<BookingDocument>("marketplace_bookings").createIndexes([{key:{id:1},unique:true},{key:{customer_id:1,request_key:1},unique:true},{key:{customer_id:1,created_at:-1}},{key:{provider_id:1,status:1,created_at:-1}}]),
      db.collection<OccurrenceDocument>("marketplace_occurrences").createIndexes([{key:{id:1},unique:true},{key:{booking_id:1,starts_at:1},unique:true},{key:{provider_id:1,starts_at:1,ends_at:1}}]),
      db.collection<ReviewDocument>("marketplace_reviews").createIndexes([{key:{id:1},unique:true},{key:{booking_id:1},unique:true},{key:{provider_id:1,visible:1,created_at:-1}}]),
      db.collection<EventDocument>("marketplace_events").createIndex({booking_id:1,created_at:-1}),
      db.collection<CustomerLock>("marketplace_customer_locks").createIndex({version:1}),
    ]);
  })().catch(error=>{initialized.delete(db.databaseName);throw error;}));
  return initialized.get(db.databaseName)!;
}
function escapeRegex(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
function exactCategory(name:string){return new RegExp(`^${escapeRegex(name)}$`,"i");}
function duplicateKey(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&error.code===11000;}
function publicProvider(p:ProviderDocument):MarketplaceProvider{const {_id,reservation_version,...profile}=p;void _id;void reservation_version;return profile;}
async function activeMarketplaceActor(userId:string,session:ClientSession){
  const db=await getMongoDb();
  // Account deactivation writes this same user before its account-state change.
  // Serialize every mutation with revocation, then read the state in the same snapshot.
  const user=await db.collection<UserDocument>("users").findOneAndUpdate({id:userId},{$inc:{marketplace_version:1}},{session});
  if(!user)throw new HttpError(401,"Please sign in to continue.");
  const state=await db.collection("platform_account_status").findOne({user_id:userId},{session});
  if(!isAccountActive(user,state))throw new HttpError(403,"This account is unavailable.");
}

export const providerSchema=z.object({
  display_name:z.string().trim().min(2).max(80),category:z.string().trim().min(2).max(80),city:z.string().trim().min(2).max(80),
  description:z.string().trim().min(30).max(2000),skills:z.string().trim().min(3).max(300),experience:z.coerce.number().int().min(0).max(60),
  hourly_rate:z.coerce.number().int().min(50).max(100000),daily_rate:z.coerce.number().int().min(100).max(500000),monthly_rate:z.coerce.number().int().min(500).max(5000000),
  opening_hour:z.coerce.number().int().min(6).max(18),closing_hour:z.coerce.number().int().min(7).max(22),
}).refine(p=>p.closing_hour-p.opening_hour>=8,{message:"Offer at least eight hours between opening and closing."});

export async function saveMarketplaceProvider(userId:string,input:unknown){
  await ensureMarketplace();const parsed=providerSchema.safeParse(input);
  if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"Check the profile details.");
  const p=parsed.data,db=await getMongoDb();
  const id=randomUUID();
  await withMongoTransaction(async session=>{
    await activeMarketplaceActor(userId,session);
    const category=await db.collection<CategoryDocument>("categories").findOne({...activeCatalogFilter,$or:[{slug:p.category},{"payload.name":exactCategory(p.category)}]},{session});
    if(!category)throw new HttpError(400,"Choose an active service category.");
    await db.collection<ProviderDocument>("marketplace_providers").updateOne({user_id:userId},{$set:{...p,category:category.payload.name,active:0,verified:0,verification_status:"pending",verification_reason:"Profile updated; awaiting review.",reviewer_id:null,reviewed_at:null},$setOnInsert:{_id:id,id,user_id:userId,created_at:new Date().toISOString(),reservation_version:0}},{upsert:true,session});
    await db.collection("users").updateOne({id:userId,role:{$in:["customer","CUSTOMER"]}},{$set:{role:"PROVIDER"}},{session});
  });
  return getProviderForUser(userId);
}
export async function getProviderForUser(userId:string){
  await ensureMarketplace();const p=await(await getMongoDb()).collection<ProviderDocument>("marketplace_providers").findOne({user_id:userId});return p?publicProvider(p):null;
}
function reviewSummaryStages():Document[]{return[
  {$lookup:{from:"marketplace_reviews",localField:"id",foreignField:"provider_id",pipeline:[{$match:{visible:1}},{$group:{_id:null,rating:{$avg:"$rating"},review_count:{$sum:1}}}],as:"_reviews"}},
  {$set:{rating:{$ifNull:[{$arrayElemAt:["$_reviews.rating",0]},null]},review_count:{$ifNull:[{$arrayElemAt:["$_reviews.review_count",0]},0]}}},
  {$unset:["_id","_reviews","reservation_version","verification_reason","reviewer_id","reviewed_at"]},
];}
export async function getMarketplaceProvider(id:string):Promise<MarketplaceProvider|null>{
  await ensureMarketplace();const categories=await readMarketplaceCategories();
  const [p]=await(await getMongoDb()).collection<ProviderDocument>("marketplace_providers").aggregate<MarketplaceProvider>([{$match:{id,active:1,category:{$in:categories.map(c=>exactCategory(c.name))}}},...reviewSummaryStages()]).toArray();return p||null;
}
export async function listMarketplaceProviders(filters:{q?:string;category?:string;city?:string;max?:number;verified?:boolean;sort?:string;page?:number;date?:string;rating?:number;duration?:string;experience?:number}={}){
  await ensureMarketplace();const categories=await readMarketplaceCategories(),db=await getMongoDb();
  const empty={providers:[] as MarketplaceProvider[],count:0,page:1,pages:0};if(!categories.length)return empty;
  const priceColumn=filters.duration==="full_day"?"daily_rate":filters.duration==="monthly"?"monthly_rate":"hourly_rate";
  const match:Filter<ProviderDocument>={active:1,category:{$in:categories.map(c=>exactCategory(c.name))}};
  if(filters.q)match.$or=["display_name","skills","category"].map(field=>({[field]:new RegExp(escapeRegex(filters.q!.slice(0,100)),"i")}));
  if(filters.category){const name=categories.find(c=>c.slug===filters.category||c.name.toLowerCase()===filters.category!.toLowerCase())?.name;if(!name)return empty;match.category=exactCategory(name);}
  if(filters.city)match.city=new RegExp(escapeRegex(filters.city.slice(0,80)),"i");
  if(filters.max&&Number.isFinite(filters.max))match[priceColumn]={$lte:filters.max};
  if(filters.experience&&Number.isFinite(filters.experience))match.experience={$gte:filters.experience};
  if(filters.verified)match.verified=1;
  const pipeline:Document[]=[{$match:match},...reviewSummaryStages()];
  if(filters.rating&&Number.isFinite(filters.rating))pipeline.push({$match:{rating:{$gte:filters.rating}}});
  if(filters.date&&/^\d{4}-\d{2}-\d{2}$/.test(filters.date)){
    const start=new Date(`${filters.date}T00:00:00+05:30`);
    if(Number.isFinite(start.getTime())){const end=new Date(start.getTime()+86400000);pipeline.push(
      {$lookup:{from:"marketplace_occurrences",let:{providerId:"$id"},pipeline:[
        {$match:{$expr:{$eq:["$provider_id","$$providerId"]},starts_at:{$lt:end.toISOString()},ends_at:{$gt:start.toISOString()}}},
        {$lookup:{from:"marketplace_bookings",localField:"booking_id",foreignField:"id",pipeline:[{$match:{status:{$ne:"cancelled"}}}],as:"booking"}},
        {$match:{"booking.0":{$exists:true}}},{$limit:1},{$project:{_id:1}},
      ],as:"_reserved"}},{$match:{"_reserved.0":{$exists:false}}},{$unset:"_reserved"});}
  }
  const collection=db.collection<ProviderDocument>("marketplace_providers");
  const count=(await collection.aggregate<{count:number}>([...pipeline,{$count:"count"}]).toArray())[0]?.count||0;
  const requestedPage=Number.isFinite(filters.page)?Math.floor(filters.page||1):1,page=Math.max(1,Math.min(Math.ceil(count/9)||1,requestedPage));
  const order=filters.sort==="price-desc"?{[priceColumn]:-1,id:1}:filters.sort==="experience"?{experience:-1,id:1}:filters.sort==="price"?{[priceColumn]:1,id:1}:{created_at:-1,id:1};
  const providers=await collection.aggregate<MarketplaceProvider>([...pipeline,{$sort:order},{$skip:(page-1)*9},{$limit:9}]).toArray();return{providers,count,page,pages:Math.ceil(count/9)};
}

export const marketplaceBookingSchema=z.object({provider_id:z.string().uuid(),kind:z.enum(["hourly","full_day","monthly"]),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),time:z.string().regex(/^\d{2}:00$/),hours:z.coerce.number().int().min(1).max(8),requirements:z.string().trim().min(10).max(2000),address:z.string().trim().min(10).max(500),terms:z.literal(true),request_key:z.string().uuid(),expected_total:z.number().int().positive()});
export function calculateMarketplaceSchedule(p:MarketplaceProvider,input:z.infer<typeof marketplaceBookingSchema>,now=Date.now()){
  const first=new Date(`${input.date}T${input.time}:00+05:30`);
  if(!Number.isFinite(first.getTime())||first.getTime()<=now||first.getTime()>now+180*86400000)throw new HttpError(400,"Choose a future date within the next 180 days.");
  if(new Date(first.getTime()+330*60000).toISOString().slice(0,10)!==input.date)throw new HttpError(400,"Choose a valid calendar date.");
  const duration=input.kind==="hourly"?input.hours:8,hour=Number(input.time.slice(0,2));
  if(hour<p.opening_hour||hour+duration>p.closing_hour)throw new HttpError(400,"The selected hours fall outside the professional’s working hours.");
  const occurrences:{starts_at:string;ends_at:string}[]=[];
  for(let day=0;occurrences.length<(input.kind==="monthly"?20:1);day++){
    const start=new Date(first.getTime()+day*86400000),localDay=new Date(start.getTime()+330*60000).getUTCDay();
    if(input.kind==="monthly"&&(localDay===0||localDay===6))continue;
    occurrences.push({starts_at:start.toISOString(),ends_at:new Date(start.getTime()+duration*3600000).toISOString()});
  }
  return{occurrences,total:input.kind==="hourly"?p.hourly_rate*duration:input.kind==="full_day"?p.daily_rate:p.monthly_rate,hours:duration*occurrences.length};
}
export async function createMarketplaceBooking(userId:string,input:unknown){
  await ensureMarketplace();const parsed=marketplaceBookingSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,"Complete the booking details and accept the booking terms.");
  await ensureOperations();
  const data=parsed.data,db=await getMongoDb();
  const providers=db.collection<ProviderDocument>("marketplace_providers"),bookings=db.collection<BookingDocument>("marketplace_bookings"),occurrences=db.collection<OccurrenceDocument>("marketplace_occurrences"),locks=db.collection<CustomerLock>("marketplace_customer_locks");
  const requestHash=createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const id=randomUUID(),createdAt=new Date().toISOString();
  const queue=await prepareQueueNumber("provider",id,`provider:${data.provider_id}`,data.date);
  try{await locks.updateOne({_id:userId},{$setOnInsert:{version:0}},{upsert:true});}catch(error){if(!duplicateKey(error))throw error;}
  const result=await withDistributedLock(`marketplace-booking:${data.provider_id}`,async assertOwned=>withMongoTransaction(async session=>{
    await activeMarketplaceActor(userId,session);
    // Real writes create a serial order. Mongo no-op updates do not take the required write lock.
    // Customer lock binds idempotency across providers; provider lock prevents overlapping reservations.
    await locks.updateOne({_id:userId},{$inc:{version:1}},{session});
    const p=await providers.findOneAndUpdate({id:data.provider_id},{$inc:{reservation_version:1}},{session,returnDocument:"after"});
    const existing=await bookings.findOne({customer_id:userId,request_key:data.request_key},{session});
    if(existing){if(existing.request_hash!==requestHash)throw new HttpError(409,"This request reference was already used for different booking details. Start a new booking.");return{id:existing.id};}
    if(!p||p.active!==1)throw new HttpError(404,"This professional is not currently accepting bookings.");
    const category=await db.collection<CategoryDocument>("categories").findOne({...activeCatalogFilter,"payload.name":exactCategory(p.category)},{session});
    if(!category)throw new HttpError(409,"This service category is not currently accepting bookings.");
    if(p.user_id===userId)throw new HttpError(400,"You cannot book your own service.");
    const schedule=calculateMarketplaceSchedule(p,data);if(schedule.total!==data.expected_total)throw new HttpError(409,"The professional’s price has changed. Refresh the booking page to review the current price before submitting.");
    const conflict=await occurrences.aggregate([
      {$match:{provider_id:p.id,$or:schedule.occurrences.map(v=>({starts_at:{$lt:v.ends_at},ends_at:{$gt:v.starts_at}}))}},
      {$lookup:{from:"marketplace_bookings",localField:"booking_id",foreignField:"id",pipeline:[{$match:{status:{$ne:"cancelled"}}}],as:"booking"}},
      {$match:{"booking.0":{$exists:true}}},{$limit:1},{$project:{_id:1}},
    ],{session}).next();
    if(conflict)throw new HttpError(409,"This time is already reserved. Choose another date or time.");
    assertOwned();await bookings.insertOne({_id:id,id,customer_id:userId,provider_id:p.id,kind:data.kind,starts_at:schedule.occurrences[0].starts_at,ends_at:schedule.occurrences.at(-1)!.ends_at,status:"pending",total:schedule.total,payment_status:"pending",requirements:data.requirements,address:data.address,hours:schedule.hours,request_key:data.request_key,request_hash:requestHash,created_at:createdAt,state_version:0},{session});
    await issueServiceToken("provider",id,userId,createdAt,session,{...queue,service_ids:[data.provider_id],assigned_provider_id:p.id,assigned_user_id:p.user_id,estimated_minutes:data.kind==="hourly"?data.hours*60:480});
    await occurrences.insertMany(schedule.occurrences.map(visit=>{const visitId=randomUUID();return{_id:visitId,id:visitId,booking_id:id,provider_id:p.id,...visit};}),{session});
    const eventId=randomUUID();await db.collection<EventDocument>("marketplace_events").insertOne({_id:eventId,id:eventId,booking_id:id,actor_id:userId,status:"pending",created_at:createdAt},{session});assertOwned();return{id};
  }),{ttlMs:30000,waitMs:5000});
  await publishQueueBooking("provider",result.id);return result;
}
function bookingRelations():Document[]{return[
  {$lookup:{from:"marketplace_providers",localField:"provider_id",foreignField:"id",as:"_provider"}},
  {$lookup:{from:"users",localField:"customer_id",foreignField:"id",as:"_customer"}},
  {$set:{provider_name:{$ifNull:[{$arrayElemAt:["$_provider.display_name",0]},"Professional"]},customer_name:{$ifNull:[{$arrayElemAt:["$_customer.name",0]},"Customer"]}}},
];}
const cleanBookingStage={$unset:["_id","_provider","_customer","state_version","request_key","request_hash"]};
export async function listMarketplaceBookings(userId:string,asProvider=false):Promise<MarketplaceBooking[]>{
  await ensureMarketplace();const db=await getMongoDb();let filter:Filter<BookingDocument>={customer_id:userId};
  if(asProvider){const p=await db.collection<ProviderDocument>("marketplace_providers").findOne({user_id:userId},{projection:{id:1}});if(!p)return[];filter={provider_id:p.id};}
  return db.collection<BookingDocument>("marketplace_bookings").aggregate<MarketplaceBooking>([{$match:filter},{$sort:{created_at:-1,id:1}},{$limit:200},...bookingRelations(),cleanBookingStage]).toArray();
}
export async function getMarketplaceBooking(userId:string,id:string):Promise<MarketplaceBooking|null>{
  await ensureMarketplace();const [booking]=await(await getMongoDb()).collection<BookingDocument>("marketplace_bookings").aggregate<MarketplaceBooking>([{$match:{id}},...bookingRelations(),{$match:{$or:[{customer_id:userId},{"_provider.user_id":userId}]}},cleanBookingStage]).toArray();return booking||null;
}
export async function transitionMarketplaceBooking(userId:string,id:string,nextStatus:unknown){
  const parsed=z.enum(["confirmed","in_progress","completed","cancelled","disputed"]).safeParse(nextStatus);
  if(!parsed.success)throw new HttpError(400,"Choose a valid booking status.");
  const status=parsed.data;
  await ensureMarketplace();const db=await getMongoDb(),bookings=db.collection<BookingDocument>("marketplace_bookings"),providers=db.collection<ProviderDocument>("marketplace_providers");
  const target=await bookings.findOne({id},{projection:{provider_id:1}});if(!target)throw new HttpError(404,"Booking not found.");
  const result=await withMongoTransaction(async session=>{
    await activeMarketplaceActor(userId,session);
    const p=await providers.findOneAndUpdate({id:target.provider_id},{$inc:{reservation_version:1}},{session,returnDocument:"after"});
    const b=await bookings.findOneAndUpdate({id},{$inc:{state_version:1}},{session,returnDocument:"after"});
    if(!b||!p||(b.customer_id!==userId&&p.user_id!==userId))throw new HttpError(404,"Booking not found.");
    const allowed:Record<string,string[]>=p.user_id===userId?{pending:["confirmed","cancelled"],confirmed:["in_progress","cancelled"],in_progress:["completed","disputed"]}:{pending:["cancelled"],confirmed:["cancelled"],in_progress:["completed","disputed"],completed:["disputed"]};
    if(!allowed[b.status]?.includes(status))throw new HttpError(409,"This booking cannot be changed to that status.");
    if(status==="in_progress"&&new Date(b.starts_at).getTime()>Date.now())throw new HttpError(409,"The scheduled service has not started yet.");
    if(status==="completed"&&new Date(b.ends_at).getTime()>Date.now())throw new HttpError(409,"Confirm completion after the scheduled service has ended.");
    if(status==="cancelled"&&b.status==="confirmed"&&new Date(b.starts_at).getTime()<=Date.now())throw new HttpError(409,"For a service that has started, contact support to resolve the booking.");
    await bookings.updateOne({id},{$set:{status}},{session});const eventId=randomUUID();await db.collection<EventDocument>("marketplace_events").insertOne({_id:eventId,id:eventId,booking_id:id,actor_id:userId,status,created_at:new Date().toISOString()},{session});await syncQueueBookingStatus("provider",id,status,userId,session);return{id,status};
  });
  await publishQueueBooking("provider",id);return result;
}
export async function getMarketplaceAvailability(providerId:string){
  await ensureMarketplace();if(!await getMarketplaceProvider(providerId))return[];
  return(await getMongoDb()).collection<OccurrenceDocument>("marketplace_occurrences").aggregate<{starts_at:string;ends_at:string}>([
    {$match:{provider_id:providerId,ends_at:{$gt:new Date().toISOString()}}},
    {$lookup:{from:"marketplace_bookings",localField:"booking_id",foreignField:"id",pipeline:[{$match:{status:{$ne:"cancelled"}}}],as:"booking"}},
    {$match:{"booking.0":{$exists:true}}},{$sort:{starts_at:1}},{$limit:500},{$project:{_id:0,starts_at:1,ends_at:1}},
  ]).toArray();
}
export async function getMarketplaceReviews(providerId:string):Promise<MarketplaceReview[]>{
  await ensureMarketplace();return(await getMongoDb()).collection<ReviewDocument>("marketplace_reviews").aggregate<MarketplaceReview>([
    {$match:{provider_id:providerId,visible:1}},{$sort:{created_at:-1}},{$limit:50},{$lookup:{from:"users",localField:"customer_id",foreignField:"id",as:"customer"}},
    {$project:{_id:0,id:1,rating:1,body:1,created_at:1,customer_name:{$ifNull:[{$arrayElemAt:["$customer.name",0]},"Customer"]}}},
  ]).toArray();
}
export async function addMarketplaceReview(userId:string,bookingId:unknown,rating:unknown,body:unknown){
  const input=z.object({bookingId:z.string().uuid(),rating:z.number().int().min(1).max(5),body:z.string().trim().min(10).max(2000)}).safeParse({bookingId,rating,body});
  if(!input.success)throw new HttpError(400,"Choose a valid booking, a rating and write at least ten characters.");
  await ensureMarketplace();
  const db=await getMongoDb(),bookings=db.collection<BookingDocument>("marketplace_bookings"),reviews=db.collection<ReviewDocument>("marketplace_reviews");
  return withMongoTransaction(async session=>{
    await activeMarketplaceActor(userId,session);
    const b=await bookings.findOneAndUpdate({id:input.data.bookingId,customer_id:userId,status:"completed"},{$inc:{state_version:1}},{session,returnDocument:"after"});
    if(!b)throw new HttpError(403,"Only the customer can review their completed booking.");
    if(await reviews.findOne({booking_id:b.id},{session,projection:{_id:1}}))throw new HttpError(409,"This booking already has a review.");
    const id=randomUUID();await reviews.insertOne({_id:id,id,booking_id:b.id,provider_id:b.provider_id,customer_id:userId,rating:input.data.rating,body:input.data.body,created_at:new Date().toISOString(),visible:1},{session});return{success:true};
  });
}
