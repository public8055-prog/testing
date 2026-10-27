import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Document, ClientSession } from "mongodb";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { activeCatalogFilter, initDb, readBookings, readServices } from "./db";
import { HttpError } from "./http";
import { ensureMarketplace } from "./marketplace";
import { initWorkforce } from "./workforce";
import { cachedJson, invalidateCatalogCache } from "./redis";
import type { Category, Service } from "./types";
import { isAccountActive, isAdminRole } from "./roles";
import { requirePersistedAdmin } from "./admin-access";
import { adminManagementMutation, isManagementAction, assertApprovedProviderDocuments } from "./admin-management";
import { validateUploadReference } from "./uploads";

type Actor={id:string;role:string};
type Row=Document & {_id:string};
type Profile={phone:string;address:string;timezone:string;email_notifications:number};
type Review={id:string;booking_id:string;rating:number;body:string;status:string;created_at:string};
type Complaint={id:string;subject:string;body:string;status:string;response:string;created_at:string};
export type AdminService=Service & {active?:boolean;archived?:boolean;deleted?:boolean;providerIds?:string[]};
export type AdminCategory=Category & {active?:boolean;archived?:boolean;position?:number};
export type PlatformBanner={id:string;title:string;description:string;image:string;imageUploadId?:string;ctaLabel:string;ctaPath:string;active:boolean;startsAt:string|null;endsAt:string|null;position:number};
export function parsePayload<T>(value:unknown):T{return(typeof value==="string"?JSON.parse(value):value||{})as T;}
function plain(row:Row):Record<string,unknown>{const{_id,...value}=row;void _id;return value;}
function duplicate(error:unknown){return typeof error==="object"&&error!==null&&"code"in error&&error.code===11000;}
let ready:Promise<void>|undefined;
export async function ensurePlatform(){
 if(!ready)ready=(async()=>{
  await initDb();const db=await getMongoDb();
  await Promise.all([
   db.collection("platform_account_status").createIndex({user_id:1},{unique:true}),db.collection("platform_profiles").createIndex({user_id:1},{unique:true}),
   db.collection("platform_favorites").createIndex({user_id:1,service_slug:1},{unique:true}),db.collection("platform_reviews").createIndex({booking_id:1},{unique:true}),
   db.collection("platform_reviews").createIndex({user_id:1,created_at:-1}),db.collection("platform_complaints").createIndex({user_id:1,created_at:-1}),
   db.collection("platform_config").createIndex({key:1},{unique:true}),db.collection("platform_audit").createIndex({created_at:-1}),
   db.collection("platform_provider_verifications").createIndex({provider_id:1},{unique:true}),
   db.collection("platform_banners").createIndex({id:1},{unique:true}),db.collection("platform_banners").createIndex({active:1,position:1}),
   db.collection("platform_provider_documents").createIndex({upload_id:1},{unique:true}),db.collection("platform_provider_documents").createIndex({provider_id:1,created_at:-1}),
  ]);
  await db.collection<Row>("platform_locks").updateOne({_id:"admin-mutations"},{$setOnInsert:{version:0}},{upsert:true});
 })().catch(error=>{ready=undefined;throw error;});return ready;
}
export function assertAdministrator(actor:Actor){if(!isAdminRole(actor.role))throw new HttpError(403,"Administrator access required.");}
export async function readPlatformConfig():Promise<Record<string,string>>{await ensurePlatform();const rows=await(await getMongoDb()).collection<Row>("platform_config").find({},{projection:{key:1,value:1}}).toArray();return Object.fromEntries(rows.map(r=>[String(r.key),String(r.value)]));}
export async function getActiveBanners(now=new Date()):Promise<PlatformBanner[]>{
 await ensurePlatform();const timestamp=now.toISOString();
 const candidates=await cachedJson<PlatformBanner[]>("public-banners",30,async()=>{
  const rows=await(await getMongoDb()).collection<Row>("platform_banners").find({active:true,deleted:{$ne:true}}).sort({position:1,created_at:1}).toArray();
  return rows.map(row=>({id:String(row.id),title:String(row.title),description:String(row.description),image:String(row.image),ctaLabel:String(row.ctaLabel),ctaPath:String(row.ctaPath),active:true,startsAt:row.startsAt?String(row.startsAt):null,endsAt:row.endsAt?String(row.endsAt):null,position:Number(row.position)}));
 });
 // Cache candidates, not time-dependent visibility: schedule boundaries apply on every read.
 return candidates.filter(row=>(!row.startsAt||row.startsAt<=timestamp)&&(!row.endsAt||row.endsAt>timestamp)).slice(0,12);
}
const profileSchema=z.object({name:z.string().trim().min(2).max(80),phone:z.string().trim().max(25).regex(/^[+\d ()-]*$/),address:z.string().trim().max(500),timezone:z.enum(["Asia/Kolkata","UTC"]),emailNotifications:z.boolean()});
export async function updateProfile(userId:string,input:unknown){
 await ensurePlatform();const parsed=profileSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,"Check your name, phone and address.");const p=parsed.data,db=await getMongoDb();
 await withMongoTransaction(async session=>{
  const result=await db.collection<Row>("users").updateOne({id:userId},{$set:{name:p.name}},{session});if(!result.matchedCount)throw new HttpError(404,"Account not found.");
  await db.collection<Row>("platform_profiles").updateOne({user_id:userId},{$set:{phone:p.phone,address:p.address,timezone:p.timezone,email_notifications:p.emailNotifications?1:0},$setOnInsert:{_id:userId,user_id:userId}},{upsert:true,session});
 });
}
export async function customerData(userId:string){
 await ensurePlatform();await ensureMarketplace();const db=await getMongoDb();
 const[bookings,profile,favorites,reviews,complaints,availableServices,providerReviews,legacyCounts,providerCounts]=await Promise.all([
  readBookings(userId,100),db.collection<Row&Profile>("platform_profiles").findOne({user_id:userId}),
  db.collection<Row>("platform_favorites").find({user_id:userId}).sort({created_at:-1}).toArray(),
  db.collection<Row&Review>("platform_reviews").find({user_id:userId}).sort({created_at:-1}).toArray(),
  db.collection<Row&Complaint>("platform_complaints").find({user_id:userId}).sort({created_at:-1}).toArray(),readServices(),
  db.collection<Row&Review>("marketplace_reviews").find({customer_id:userId}).sort({created_at:-1}).toArray(),
  db.collection<Row>("bookings").aggregate<{_id:string;count:number}>([{$match:{user_id:userId}},{$group:{_id:"$status",count:{$sum:1}}}]).toArray(),
  db.collection<Row>("marketplace_bookings").aggregate<{_id:string;count:number}>([{$match:{customer_id:userId}},{$group:{_id:"$status",count:{$sum:1}}}]).toArray(),
 ]);
 const saved=await db.collection<Row>("services").find({slug:{$in:favorites.map(f=>String(f.service_slug))},deleted:{$ne:true}}).toArray();
 const counts={total:0,active:0,completed:0};for(const s of[...legacyCounts,...providerCounts]){counts.total+=s.count;if(["pending","confirmed","in_progress"].includes(s._id))counts.active+=s.count;if(s._id==="completed")counts.completed+=s.count;}
 return{bookings,profile:profile?{phone:profile.phone,address:profile.address,timezone:profile.timezone,email_notifications:profile.email_notifications}:{phone:"",address:"",timezone:"Asia/Kolkata",email_notifications:1},
  favorites:saved.map(s=>({...parsePayload<Service>(s.payload),price:Number(s.price)})),
  reviews:[...reviews.map(r=>({id:r.id,booking_id:r.booking_id,rating:r.rating,body:r.body,status:r.status,created_at:r.created_at})),...providerReviews.map(r=>({id:r.id,booking_id:r.booking_id,rating:r.rating,body:r.body,status:Number(r.visible)===1?"published":"hidden",created_at:r.created_at}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)),
  complaints:complaints.map(c=>({id:c.id,subject:c.subject,body:c.body,status:c.status,response:c.response||"",created_at:c.created_at})),availableServices:availableServices.map(s=>({slug:s.slug,title:s.title})),counts};
}
export async function toggleFavorite(userId:string,serviceSlug:string){
 await ensurePlatform();if(!/^[a-z0-9-]{1,120}$/.test(serviceSlug))throw new HttpError(400,"Choose a service.");const db=await getMongoDb();
 return withMongoTransaction(async session=>{
  const user=await db.collection<Row>("users").updateOne({id:userId},{$inc:{favorite_version:1}},{session});if(!user.matchedCount)throw new HttpError(404,"Account not found.");
  const collection=db.collection<Row>("platform_favorites"),removed=await collection.deleteOne({user_id:userId,service_slug:serviceSlug},{session});if(removed.deletedCount)return false;
  const service=await db.collection<Row>("services").findOne({slug:serviceSlug,...activeCatalogFilter},{session});
  if(!service||!await db.collection<Row>("categories").findOne({slug:service.category,...activeCatalogFilter},{session}))throw new HttpError(404,"Service not found.");
  await collection.insertOne({_id:`${userId}:${serviceSlug}`,user_id:userId,service_slug:serviceSlug,created_at:new Date().toISOString()},{session});return true;
 });
}
export async function createReview(userId:string,input:unknown){
 await ensurePlatform();const parsed=z.object({bookingId:z.string().max(100),rating:z.number().int().min(1).max(5),body:z.string().trim().min(10).max(2000)}).safeParse(input);if(!parsed.success)throw new HttpError(400,"Select a completed booking, a rating and at least 10 characters of feedback.");
 const p=parsed.data,db=await getMongoDb(),id=randomUUID();
 try{await withMongoTransaction(async session=>{const booking=await db.collection<Row>("bookings").updateOne({id:p.bookingId,user_id:userId,status:"completed"},{$inc:{review_version:1}},{session});if(!booking.matchedCount)throw new HttpError(403,"You can review only your completed bookings.");await db.collection<Row>("platform_reviews").insertOne({_id:id,id,user_id:userId,booking_id:p.bookingId,rating:p.rating,body:p.body,status:"published",created_at:new Date().toISOString()},{session});});}catch(error){if(duplicate(error))throw new HttpError(409,"You already reviewed this booking.");throw error;}return id;
}
export async function createComplaint(userId:string,input:unknown){
 await ensurePlatform();const parsed=z.object({bookingId:z.string().max(100).optional(),subject:z.string().trim().min(4).max(120),body:z.string().trim().min(15).max(4000)}).safeParse(input);if(!parsed.success)throw new HttpError(400,"Add a subject and at least 15 characters describing the issue.");const p=parsed.data,db=await getMongoDb();let bookingKind:string|null=null;
 if(p.bookingId){if(await db.collection<Row>("bookings").findOne({id:p.bookingId,user_id:userId},{projection:{_id:1}}))bookingKind="service";else if(await db.collection<Row>("marketplace_bookings").findOne({id:p.bookingId,customer_id:userId},{projection:{_id:1}}))bookingKind="provider";else throw new HttpError(404,"Booking not found.");}
 const id=randomUUID(),now=new Date().toISOString();await db.collection<Row>("platform_complaints").insertOne({_id:id,id,user_id:userId,booking_id:p.bookingId||null,booking_kind:bookingKind,subject:p.subject,body:p.body,status:"open",response:"",created_at:now,updated_at:now});return id;
}
export async function adminData(actor:Actor){
 assertAdministrator(actor);await ensurePlatform();await requirePersistedAdmin(actor);await ensureMarketplace();await initWorkforce();const db=await getMongoDb();
 const[userRows,statuses,bookingRows,categoryRows,serviceRows,reviews,complaints,audit,config,providers,providerBookings,providerReviews,businesses,attendanceReview,userCount,bookingCounts,complaintCount,refunds,verifications,banners]=await Promise.all([
  db.collection<Row>("users").find({},{projection:{id:1,name:1,email:1,role:1,created_at:1}}).sort({created_at:-1}).limit(500).toArray(),db.collection<Row>("platform_account_status").find({}).toArray(),
  db.collection<Row>("bookings").find({}).sort({created_at:-1}).limit(500).toArray(),db.collection<Row>("categories").find({}).sort({slug:1}).toArray(),db.collection<Row>("services").find({}).sort({slug:1}).toArray(),
  db.collection<Row>("platform_reviews").find({}).sort({created_at:-1}).limit(300).toArray(),db.collection<Row>("platform_complaints").find({}).sort({created_at:-1}).limit(300).toArray(),db.collection<Row>("platform_audit").find({}).sort({created_at:-1}).limit(500).toArray(),readPlatformConfig(),
  db.collection<Row>("marketplace_providers").find({}).sort({created_at:-1}).limit(500).toArray(),db.collection<Row>("marketplace_bookings").find({}).sort({created_at:-1}).limit(500).toArray(),db.collection<Row>("marketplace_reviews").find({}).sort({created_at:-1}).limit(300).toArray(),db.collection<Row>("wf_businesses").find({}).sort({created_at:-1}).limit(500).toArray(),
  db.collection("wf_corrections").countDocuments({status:"pending"}),db.collection("users").countDocuments(),db.collection("bookings").aggregate<{_id:string;count:number}>([{$group:{_id:"$status",count:{$sum:1}}}]).toArray(),db.collection("platform_complaints").countDocuments({status:"open"}),
  db.collection<Row>("payment_refunds").find({}).sort({created_at:-1}).limit(500).toArray(),db.collection<Row>("platform_provider_verifications").find({}).toArray(),
  db.collection<Row>("platform_banners").find({deleted:{$ne:true}}).sort({position:1,created_at:-1}).limit(100).toArray(),
 ]);
 const bannerRows=banners.map(row=>({id:String(row.id),title:String(row.title),description:String(row.description),image:String(row.image),ctaLabel:String(row.ctaLabel),ctaPath:String(row.ctaPath),active:Boolean(row.active),startsAt:row.startsAt?String(row.startsAt):null,endsAt:row.endsAt?String(row.endsAt):null,position:Number(row.position),imageUploadId:row.imageUploadId?String(row.imageUploadId):undefined}));
 const names=new Map(userRows.map(u=>[String(u.id),String(u.name)])),statusMap=new Map(statuses.map(s=>[String(s.user_id),Number(s.active)])),providerNames=new Map(providers.map(p=>[String(p.id),String(p.display_name)]));
 const users=userRows.map(u=>({id:String(u.id),name:String(u.name),email:String(u.email),role:String(u.role),created_at:String(u.created_at),active:statusMap.get(String(u.id))??1}));
 const bookings=bookingRows.map(b=>({id:String(b.id),name:String(b.name),date:String(b.date),status:String(b.status),total:Number(b.total),payment_status:String(b.payment_status)}));
 const services:AdminService[]=serviceRows.map(s=>({...parsePayload<Service>(s.payload),slug:String(s.slug),category:String(s.category),price:Number(s.price),providerIds:Array.isArray(s.provider_ids)?s.provider_ids:[],active:s.active!==false&&parsePayload<AdminService>(s.payload).active!==false,archived:s.archived===true||parsePayload<AdminService>(s.payload).archived===true,deleted:s.deleted===true||parsePayload<AdminService>(s.payload).deleted===true}));
 const categories:AdminCategory[]=categoryRows.map(c=>({...parsePayload<AdminCategory>(c.payload),slug:String(c.slug),position:Number(c.position||0),active:c.active!==false&&parsePayload<AdminCategory>(c.payload).active!==false,archived:c.archived===true||parsePayload<AdminCategory>(c.payload).archived===true,servicesCount:services.filter(s=>s.category===c.slug&&!s.deleted).length}));
 const counts=Object.fromEntries(bookingCounts.map(c=>[c._id,c.count]));
 const[queueMetrics,ongoingCatalog,ongoingProvider,approvalCount,paidProvider,paidCatalog,confirmedRefunds,activeProviders]=await Promise.all([
  db.collection("service_tokens").aggregate<{_id:string;count:number}>([{$match:{queue_status:{$in:["waiting","called","in_service"]}}},{$group:{_id:"$queue_status",count:{$sum:1}}}]).toArray(),
  db.collection("bookings").countDocuments({status:"in_progress"}),db.collection("marketplace_bookings").countDocuments({status:"in_progress"}),
  db.collection("marketplace_providers").countDocuments({active:0,verification_status:{$in:["pending",null]}}),
  db.collection("marketplace_bookings").aggregate<{total:number}>([{$match:{payment_status:{$in:["paid","refund_pending","refunded"]}}},{$group:{_id:null,total:{$sum:"$total"}}}]).toArray(),
  db.collection("bookings").aggregate<{total:number}>([{$match:{payment_status:{$in:["paid","refund_pending","refunded"]}}},{$group:{_id:null,total:{$sum:"$total"}}}]).toArray(),
  db.collection("payment_refunds").aggregate<{total:number}>([{$match:{status:"succeeded"}},{$group:{_id:null,total:{$sum:"$amount"}}}]).toArray(),
  db.collection("marketplace_providers").countDocuments({active:1}),
 ]);
 const queueTotal=queueMetrics.reduce((sum,row)=>sum+row.count,0),netRevenue=(paidProvider[0]?.total||0)+(paidCatalog[0]?.total||0)-(confirmedRefunds[0]?.total||0)/100;
 const transactions=bookingRows.filter(b=>b.payment_provider||b.razorpay_payment_id||b.stripe_payment_intent_id||b.payment_status!=="unpaid").map(b=>({id:String(b.id),customer:String(b.name),provider:String(b.payment_provider||b.payment||"cash"),transaction_id:String(b.razorpay_payment_id||b.stripe_payment_intent_id||""),order_id:String(b.razorpay_order_id||b.stripe_session_id||""),amount:Number(b.total),currency:"INR",status:String(b.payment_status),created_at:String(b.created_at)}));
 return{users,bookings,categories,services,banners:bannerRows,reviews:[...reviews.map(r=>({...plain(r),source:"service",name:names.get(String(r.user_id))||"Customer"})),...providerReviews.map(r=>({...plain(r),source:"provider",name:names.get(String(r.customer_id))||"Customer",status:Number(r.visible)===1?"published":"hidden"}))]as Record<string,unknown>[],
  complaints:complaints.map(c=>({...plain(c),name:names.get(String(c.user_id))||"Customer"}))as Record<string,unknown>[],audit:audit.map(a=>({...plain(a),name:names.get(String(a.actor_id))||"Administrator"}))as Record<string,unknown>[],config,
  providers:providers.map(p=>({...plain(p),verification:verifications.find(v=>v.provider_id===p.id)?plain(verifications.find(v=>v.provider_id===p.id)!):null}))as Record<string,unknown>[],providerBookings:providerBookings.map(b=>({...plain(b),provider_name:providerNames.get(String(b.provider_id))||"Provider"}))as Record<string,unknown>[],
  businesses:businesses.map(b=>({id:b.id,name:b.name,timezone:b.timezone,created_at:b.created_at,owner_email:userRows.find(u=>u.id===b.owner_id)?.email||""})),attendanceReview,metrics:{users:userCount,bookings:bookingCounts.reduce((n,c)=>n+c.count,0),pending:counts.pending||0,completed:counts.completed||0,revenue:netRevenue,complaints:complaintCount,activeQueue:queueTotal,ongoing:ongoingCatalog+ongoingProvider,approvals:approvalCount,activeProviders},transactions,refunds:refunds.map(plain)};
}
const serviceInput=z.object({action:z.literal("service"),slug:z.string().regex(/^[a-z0-9-]{2,100}$/),title:z.string().trim().min(3).max(120),category:z.string().min(2).max(80),description:z.string().trim().min(15).max(3000),price:z.number().int().min(0).max(1000000),durationMin:z.number().int().min(15).max(600),image:z.string().trim().max(1200).refine(v=>!v||v.startsWith("/")&&!v.startsWith("//")||/^https:\/\//i.test(v),"Use a local asset path or HTTPS image."),includes:z.array(z.string().trim().min(2).max(200)).min(1).max(20),active:z.boolean(),archived:z.boolean().default(false),providerIds:z.array(z.string().min(1).max(100)).max(50).default([])});
const adminActionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("banner"),id:z.string().uuid().optional(),title:z.string().trim().min(3).max(120),description:z.string().trim().max(300),image:z.string().max(1500).refine(value=>{if(/^\/api\/uploads\/[a-f0-9-]{36}$/.test(value))return true;try{const url=new URL(value);return["https:","http:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}},"Use an HTTP or HTTPS image URL or a securely uploaded image."),imageUploadId:z.string().uuid().optional(),ctaLabel:z.string().trim().min(2).max(40),ctaPath:z.string().trim().regex(/^\/(?!\/)[a-zA-Z0-9/_?&=.%~#-]*$/,"Use an internal page path, such as /services."),active:z.boolean(),startsAt:z.iso.datetime().nullable().default(null),endsAt:z.iso.datetime().nullable().default(null),position:z.number().int().min(0).max(1000).default(0)}),z.object({action:z.literal("banner-delete"),id:z.string().uuid()}),z.object({action:z.literal("banner-reorder"),ids:z.array(z.string().uuid()).min(1).max(100)}),
 z.object({action:z.literal("category"),slug:z.string().regex(/^[a-z0-9-]{2,80}$/),name:z.string().trim().min(2).max(80),tagline:z.string().trim().max(180),active:z.boolean().default(true),archived:z.boolean().default(false),position:z.number().int().min(0).max(10000).default(0)}),z.object({action:z.literal("category-delete"),slug:z.string().max(80)}),serviceInput,z.object({action:z.literal("service-delete"),slug:z.string().max(120)}),
 z.object({action:z.literal("service-price"),slug:z.string().max(120),price:z.number().int().min(0).max(1000000)}),z.object({action:z.literal("review"),id:z.string().max(100),status:z.enum(["published","hidden"]),source:z.enum(["service","provider"]).default("service")}),
 z.object({action:z.literal("complaint"),id:z.string().max(100),status:z.enum(["open","investigating","resolved"]),response:z.string().trim().min(5).max(2000)}),z.object({action:z.literal("config"),key:z.enum(["homepage_headline","support_email","support_phone","catalog_discount_percent","catalog_visit_fee","catalog_fee_waiver_threshold","business_plan_note"]),value:z.string().trim().max(240)}),
 z.object({action:z.literal("provider"),id:z.string().max(100),active:z.boolean()}),z.object({action:z.literal("provider-verification"),id:z.string().max(100),identityChecked:z.boolean(),contactChecked:z.boolean(),skillsChecked:z.boolean(),reference:z.string().trim().min(8).max(500),decision:z.enum(["verified","rejected","pending"])}),
 z.object({action:z.literal("resolve-dispute"),id:z.string().max(100),status:z.enum(["completed","cancelled"]),reason:z.string().trim().min(15).max(2000)}),
]);
async function auditMutation(actor:Actor,action:string,target:string,details:unknown,session:ClientSession){const id=randomUUID();await(await getMongoDb()).collection<Row>("platform_audit").insertOne({_id:id,id,actor_id:actor.id,action,target_id:target,details:JSON.stringify(details),created_at:new Date().toISOString()},{session});}
export async function adminMutation(actor:Actor,input:unknown){
 assertAdministrator(actor);await ensurePlatform();await ensureMarketplace();if(input&&typeof input==="object"&&"action"in input&&isManagementAction(input.action)){await adminManagementMutation(actor,input);return;}const parsed=adminActionSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||"Check the submitted values.");const p=parsed.data,db=await getMongoDb();
 if(p.action==="config"&&p.key==="support_email"&&p.value&&!z.email().safeParse(p.value).success)throw new HttpError(400,"Enter a valid support email.");
 if(p.action==="config"&&p.key==="catalog_discount_percent"&&(!/^\d+(\.\d{1,2})?$/.test(p.value)||Number(p.value)>100))throw new HttpError(400,"Discount must be between 0 and 100 percent.");
 if(p.action==="config"&&["catalog_visit_fee","catalog_fee_waiver_threshold"].includes(p.key)&&(!/^\d+$/.test(p.value)||Number(p.value)>1000000))throw new HttpError(400,"Enter a whole rupee amount between 0 and 1,000,000.");
 if(p.action==="banner"&&p.startsAt&&p.endsAt&&p.endsAt<=p.startsAt)throw new HttpError(400,"The banner end time must be after its start time.");
 if(p.action==="banner"){if(p.image.startsWith("/api/uploads/")){const upload=await validateUploadReference(p.imageUploadId||p.image.split("/").pop()!,{purpose:"banner"});if(upload.url!==p.image)throw new HttpError(400,"Banner upload does not match its image.");}else if(p.imageUploadId)throw new HttpError(400,"Banner upload does not match its image.");}
 const catalogChange=["category","category-delete","service","service-price","service-delete","config"].includes(p.action),cacheChange=catalogChange||["banner","banner-delete","banner-reorder"].includes(p.action);if(cacheChange)await invalidateCatalogCache();
 await withMongoTransaction(async session=>{
  await db.collection<Row>("platform_locks").updateOne({_id:"admin-mutations"},{$inc:{version:1}},{session});
  if(catalogChange)await db.collection<Row>("app_locks").updateOne({_id:"catalog"},{$inc:{version:1}},{session});
  await requirePersistedAdmin(actor,session);let target="";
  if(p.action==="banner"){

   const id=p.id||randomUUID();target=id;const old=p.id?await db.collection<Row>("platform_banners").findOne({id,deleted:{$ne:true}},{session}):null;if(p.id&&!old)throw new HttpError(404,"Banner not found.");const{action,...fields}=p;void action;await db.collection<Row>("platform_banners").updateOne({id},{$set:{...fields,id,updated_at:new Date().toISOString()},$setOnInsert:{_id:id,created_at:new Date().toISOString()}},{upsert:true,session});
  }else if(p.action==="banner-reorder"){
   const rows=await db.collection<Row>("platform_banners").find({deleted:{$ne:true}},{session,projection:{id:1}}).toArray();if(new Set(p.ids).size!==p.ids.length||rows.length!==p.ids.length||rows.some(row=>!p.ids.includes(String(row.id))))throw new HttpError(409,"Reload the banner list before reordering.");for(const [position,id]of p.ids.entries())await db.collection<Row>("platform_banners").updateOne({id},{$set:{position,updated_at:new Date().toISOString()}},{session});target="homepage";
  }else if(p.action==="banner-delete"){
   target=p.id;const result=await db.collection<Row>("platform_banners").updateOne({id:p.id,deleted:{$ne:true}},{$set:{deleted:true,active:false,updated_at:new Date().toISOString()}},{session});if(!result.matchedCount)throw new HttpError(404,"Banner not found.");
  }else if(p.action==="category"){
   target=p.slug;const collection=db.collection<Row>("categories"),old=await collection.findOne({slug:p.slug},{session}),others=await collection.find({slug:{$ne:p.slug}},{session}).toArray();if(others.some(c=>parsePayload<Category>(c.payload).name.toLowerCase()===p.name.toLowerCase()))throw new HttpError(409,"Another category already uses this name.");
   const previous=old?parsePayload<AdminCategory>(old.payload):null,payload={...(previous||{icon:"Sparkles",image:"",color:"from-teal-500 to-emerald-500",servicesCount:0}),slug:p.slug,name:p.name,tagline:p.tagline,active:p.active&&!p.archived,archived:p.archived,position:p.position};await collection.updateOne({slug:p.slug},{$set:{payload,position:p.position,active:p.active&&!p.archived,archived:p.archived},$setOnInsert:{_id:p.slug,slug:p.slug}},{upsert:true,session});
   if(previous?.name&&previous.name!==p.name){const providers=await db.collection<Row>("marketplace_providers").find({},{session,projection:{id:1,category:1}}).toArray();const ids=providers.filter(row=>String(row.category).toLowerCase()===previous.name.toLowerCase()).map(row=>row.id);if(ids.length)await db.collection<Row>("marketplace_providers").updateMany({id:{$in:ids}},{$set:{category:p.name},$inc:{reservation_version:1}},{session});}
  }else if(p.action==="category-delete"){
   target=p.slug;const row=await db.collection<Row>("categories").findOne({slug:p.slug},{session});if(!row)throw new HttpError(404,"Category not found.");await db.collection<Row>("categories").updateOne({slug:p.slug},{$set:{active:false,archived:true,payload:{...parsePayload<AdminCategory>(row.payload),active:false,archived:true},updated_at:new Date().toISOString()}},{session});
  }else if(p.action==="service"){
   const old=await db.collection<Row>("services").findOne({slug:p.slug},{session}),previous=old?parsePayload<Service>(old.payload):null;
   if(new Set(p.providerIds).size!==p.providerIds.length)throw new HttpError(400,"Choose each provider once.");for(const id of p.providerIds){const provider=await db.collection<Row>("marketplace_providers").findOne({id},{session});if(!provider||(Number(provider.active)!==1&&!(Array.isArray(old?.provider_ids)&&old.provider_ids.includes(id))))throw new HttpError(400,"Only active approved providers can be assigned to services.");}
   target=p.slug;if(!await db.collection<Row>("categories").findOne({slug:p.category},{session}))throw new HttpError(400,"Choose an existing category.");
   const payload:AdminService={...(previous||{mrp:p.price,rating:0,reviews:0,faqs:[]}),slug:p.slug,title:p.title,category:p.category,description:p.description,price:p.price,mrp:Math.max(p.price,previous?.mrp||p.price),durationMin:p.durationMin,image:p.image,includes:p.includes,providerIds:p.providerIds,active:p.active&&!p.archived,archived:p.archived,deleted:false};
   await db.collection<Row>("services").updateOne({slug:p.slug},{$set:{category:p.category,price:p.price,payload,provider_ids:p.providerIds,active:payload.active,archived:p.archived,deleted:false,updated_at:new Date().toISOString()},$setOnInsert:{_id:p.slug,slug:p.slug,created_at:new Date().toISOString()}},{upsert:true,session});
  }else if(p.action==="service-delete"){
   target=p.slug;const result=await db.collection<Row>("services").updateOne({slug:p.slug},{$set:{active:false,archived:true,deleted:true,deleted_at:new Date().toISOString()}},{session});if(!result.matchedCount)throw new HttpError(404,"Service not found.");
  }else if(p.action==="service-price"){
   target=p.slug;const result=await db.collection<Row>("services").updateOne({slug:p.slug,deleted:{$ne:true}},{$set:{price:p.price,updated_at:new Date().toISOString()}},{session});if(!result.matchedCount)throw new HttpError(404,"Service not found.");
  }else if(p.action==="review"){
   target=p.id;const result=await db.collection<Row>(p.source==="provider"?"marketplace_reviews":"platform_reviews").updateOne({id:p.id},{$set:p.source==="provider"?{visible:p.status==="published"?1:0}:{status:p.status}},{session});if(!result.matchedCount)throw new HttpError(404,"Review not found.");
  }else if(p.action==="complaint"){
   target=p.id;const result=await db.collection<Row>("platform_complaints").updateOne({id:p.id},{$set:{status:p.status,response:p.response,updated_at:new Date().toISOString()}},{session});if(!result.matchedCount)throw new HttpError(404,"Complaint not found.");
  }else if(p.action==="resolve-dispute"){
   target=p.id;const booking=await db.collection<Row>("marketplace_bookings").findOne({id:p.id,status:"disputed"},{session});if(!booking)throw new HttpError(409,"Only a disputed provider booking can be resolved.");await db.collection<Row>("marketplace_providers").updateOne({id:String(booking.provider_id)},{$inc:{reservation_version:1}},{session});await db.collection<Row>("marketplace_bookings").updateOne({id:p.id,status:"disputed"},{$set:{status:p.status}},{session});const id=randomUUID();await db.collection<Row>("marketplace_events").insertOne({_id:id,id,booking_id:p.id,actor_id:actor.id,status:p.status,created_at:new Date().toISOString()},{session});
  }else if(p.action==="provider"||p.action==="provider-verification"){
   target=p.id;const provider=await db.collection<Row>("marketplace_providers").findOne({id:p.id},{session});if(!provider)throw new HttpError(404,"Provider not found.");
   if(p.action==="provider"){
    if(p.active){const owner=await db.collection<Row>("users").findOne({id:provider.user_id},{session}),state=await db.collection<Row>("platform_account_status").findOne({user_id:provider.user_id},{session});if(!isAccountActive(owner,state))throw new HttpError(409,"Reactivate the provider account before publishing its profile.");await assertApprovedProviderDocuments(p.id,session);if(provider.verification_status!=="approved")throw new HttpError(409,"Approve the provider application before publishing its profile.");}
    await db.collection<Row>("marketplace_providers").updateOne({id:p.id},{$set:{active:p.active?1:0},$inc:{reservation_version:1}},{session});
   }else{
    if(p.decision==="verified"&&!(p.identityChecked&&p.contactChecked&&p.skillsChecked))throw new HttpError(400,"Complete identity, contact and skills checks before marking a provider verified.");
    if(p.decision==="verified")await assertApprovedProviderDocuments(p.id,session);
    const verification={provider_id:p.id,identity_checked:p.identityChecked,contact_checked:p.contactChecked,skills_checked:p.skillsChecked,reference:p.reference,decision:p.decision,reviewer_id:actor.id,reviewed_at:new Date().toISOString()};await db.collection<Row>("platform_provider_verifications").updateOne({provider_id:p.id},{$set:verification,$setOnInsert:{_id:p.id}},{upsert:true,session});await db.collection<Row>("marketplace_providers").updateOne({id:p.id},{$set:{verified:p.decision==="verified"?1:0,verification_status:p.decision==="verified"?"approved":p.decision,...(p.decision==="verified"?{}:{active:0})},$inc:{reservation_version:1}},{session});
   }
  }else{target=p.key;await db.collection<Row>("platform_config").updateOne({key:p.key},{$set:{value:p.value,updated_at:new Date().toISOString()},$setOnInsert:{_id:p.key,key:p.key}},{upsert:true,session});}
  await auditMutation(actor,p.action,target,p,session);
 });if(cacheChange)await invalidateCatalogCache();
}
