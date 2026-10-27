import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ClientSession, Document } from "mongodb";
import { z } from "zod";
import { parsePayload, addBookingEvent } from "./db";
import { getMongoDb, mongoCollection, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { getRedis } from "./redis";
import { transitionCatalogBookingInSession } from "./catalog-bookings";
import { requestBookingRefund } from "./refunds";
import { ADMIN_ROLES,isAdminRole,isAccountActive } from "./roles";
import { ensureQueueNumbering,queueScopeId,type QueueNumber } from "./queue-numbering";
import { syncQueueBookingStatus,publishQueueBooking } from "./queue-state";

export type BookingSource = "catalog" | "provider";
export type ServiceToken = { _id: string; token: string; source: BookingSource; booking_id: string; customer_id: string; created_at: string; version: number; service_id?:string; service_ids?:string[]; queue_day?:string; sequence?:number; queue_status?:string; assigned_user_id?:string|null; assigned_provider_id?:string|null; queued_at?:string; called_at?:string|null; started_at?:string|null; completed_at?:string|null; estimated_minutes?:number; sort_order?:number;wait_seconds?:number;service_seconds?:number;skipped_count?:number };
export type ServiceUpdate = { id: string; title: string; message: string; created_at: string; read_at: string | null; popup_dismissed_at: string | null; href: string; token?: string };
export type TrackedService = { tokenId:string;token: string; source: BookingSource; bookingId: string; title: string; customerName: string; status: string; paymentStatus: string; scheduledAt: string; providerName: string | null; total: number; createdAt: string; version: number; queue?:{status:string;sequence?:number;serviceId:string;day:string;position:number;tokensAhead:number;estimatedWaitMinutes:number;currentServing:string[]}|null;followups: { id: string; message: string; createdAt: string; nextFollowupAt: string | null }[]; history: { status: string; createdAt: string }[] };
type Actor = { id: string; role: string };
const ready = new Map<string, Promise<void>>();
export async function ensureOperations() {
  const db = await getMongoDb();
  if (!ready.has(db.databaseName)) ready.set(db.databaseName, (async () => {
    await db.collection("service_tokens").updateMany({token:/^UK-/},{$set:{legacy_label:true}});
    await db.collection("service_tokens").createIndex({token:1},{name:"legacy_service_token_unique",unique:true,partialFilterExpression:{legacy_label:true}});
    const labelIndex=(await db.collection("service_tokens").listIndexes().toArray().catch(()=>[])).find(index=>index.name==="token_1"&&index.unique);
    if(labelIndex)try{await db.collection("service_tokens").dropIndex("token_1");}catch(error){if(!(error&&typeof error==="object"&&"code"in error&&error.code===27))throw error;}
    await db.collection("service_tokens").createIndex({ token: 1 }, {name:"service_token_label"});
    await db.collection("service_tokens").createIndex({ source: 1, booking_id: 1 }, { unique: true });
    await db.collection("service_tokens").createIndex({ customer_id: 1, created_at: -1 });
    await db.collection("service_followups").createIndex({ token: 1, created_at: -1 });
    await db.collection("customer_notifications").createIndex({ user_id: 1, created_at: -1 });
    await db.collection("customer_notifications").createIndex({ user_id: 1, read_at: 1, popup_dismissed_at: 1 });
    await db.collection("customer_notifications").createIndex({ event_key: 1 }, { unique: true, partialFilterExpression: { event_key: { $type: "string" } } });
    await db.collection("cash_receipts").createIndex({ source: 1, booking_id: 1 }, { unique: true });
    await db.collection("operation_requests").createIndex({ actor_id: 1, request_key: 1 }, { unique: true });
    await ensureQueueNumbering();
  })().catch(error => { ready.delete(db.databaseName); throw error; }));
  return ready.get(db.databaseName)!;
}
export async function issueServiceToken(source: BookingSource, bookingId: string, customerId: string, createdAt: string, session?: ClientSession, queue?:QueueNumber&{service_ids?:string[];assigned_user_id?:string|null;assigned_provider_id?:string|null;estimated_minutes?:number}) {
  const collection = await mongoCollection<ServiceToken>("service_tokens");
  const id = `${source}:${bookingId}`;
  const existing = await collection.findOne({ _id: id }, { session });
  if (existing) return existing;
  const {token:preparedCode,...queueFields}=queue||{};
  const token = preparedCode||`UK-${createdAt.slice(2, 10).replaceAll("-", "")}-${randomBytes(6).toString("hex").toUpperCase()}`;
  const value: ServiceToken = { _id: id, token, source, booking_id: bookingId, customer_id: customerId, created_at: createdAt, version: 0,...(queue?{...queueFields,queue_status:"waiting",queued_at:createdAt,sort_order:queue.sequence,called_at:null,started_at:null,completed_at:null}: {legacy_label:true}) };
  // Matching the unique booking key makes independent read/backfill retries harmless.
  try { const inserted=await collection.updateOne({ _id: id }, { $setOnInsert: value }, { upsert: true, session });if(queue&&inserted.upsertedCount)await(await mongoCollection("queue_counters")).updateOne({_id:queueScopeId(queue.service_id,queue.queue_day)},{$inc:{version:1}},{session}); }
  catch (error) {
    if (session || !(error && typeof error === "object" && "code" in error && error.code === 11000 && await collection.findOne({ _id: id }))) throw error;
  }
  return (await collection.findOne({ _id: id }, { session }))!;
}
export async function backfillServiceTokens() {
  await ensureOperations(); let count = 0;
  for (const source of ["catalog", "provider"] as const) {
    const cursor = (await mongoCollection(source === "catalog" ? "bookings" : "marketplace_bookings")).find({}, { projection: { id: 1, user_id: 1, customer_id: 1, created_at: 1 } });
    for await (const row of cursor) { await issueServiceToken(source, row.id, source === "catalog" ? row.user_id : row.customer_id, row.created_at); count++; }
  }
  return count;
}
async function admin(actor: Actor) {
  const user=await (await mongoCollection("users")).findOne({ id: actor.id, role:{$in:[...ADMIN_ROLES]} });
  if (!isAdminRole(actor.role) || !user||!isAccountActive(user)) throw new HttpError(403, "Administrator access required.");
  const state = await (await mongoCollection("platform_account_status")).findOne({ user_id: actor.id });
  if (state && Number(state.active) !== 1) throw new HttpError(403, "Administrator access required.");
}
export async function transactionAdmin(actor: Actor, session: ClientSession) {
  if (!isAdminRole(actor.role)) throw new HttpError(403, "Administrator access required.");
  // Platform deactivation also writes this user document before changing account status.
  // A real write serializes revocation with the operation; every driver retry checks fresh state.
  const current = await (await mongoCollection("users")).findOneAndUpdate({ id: actor.id, role: {$in:[...ADMIN_ROLES]} }, { $inc: { operations_version: 1 } }, { session });
  if (!current||!isAccountActive(current)) throw new HttpError(403, "Administrator access required.");
  const state = await (await mongoCollection("platform_account_status")).findOne({ user_id: actor.id }, { session });
  if (state && Number(state.active) !== 1) throw new HttpError(403, "Administrator access required.");
}
async function trackingDetails(token: ServiceToken): Promise<TrackedService | null> {
  const row = await (await mongoCollection(token.source === "catalog" ? "bookings" : "marketplace_bookings")).findOne({ id: token.booking_id });
  if (!row) return null;
  const [customer, provider, followups, events,queueEvents] = await Promise.all([
    (await mongoCollection("users")).findOne({ id: token.customer_id }, { projection: { name: 1 } }),
    token.source === "provider" ? (await mongoCollection("marketplace_providers")).findOne({ id: row.provider_id }, { projection: { display_name: 1 } }) : Promise.resolve(null),
    (await mongoCollection("service_followups")).find({$or:[{token_id:token._id},...(token.token.startsWith("UK-")?[{token:token.token,token_id:{$exists:false}}]:[])]}).sort({ created_at: -1 }).limit(30).toArray(),
    (await mongoCollection(token.source === "catalog" ? "booking_events" : "marketplace_events")).find({ booking_id: token.booking_id }).sort({ created_at: 1 }).limit(50).toArray(),
    (await mongoCollection("queue_events")).find({token_id:token._id}).sort({created_at:1}).limit(100).toArray(),
  ]);
  const items = token.source === "catalog" ? parsePayload<{ title: string }[]>(row.items) : [];
  const queue=await(await import("./service-queue")).queueMetricsForToken(token);
  return { tokenId:token._id,token: token.token,queue, source: token.source, bookingId: token.booking_id, title: token.source === "catalog" ? items.map(i => i.title).join(", ") || "Home service" : `${provider?.display_name || "Professional"} · ${String(row.kind).replaceAll("_", " ")}`,
    customerName: customer?.name || row.name || "Customer", status: row.status, paymentStatus: row.payment_status, scheduledAt: token.source === "catalog" ? `${row.date} · ${row.slot}` : row.starts_at,
    providerName: provider?.display_name || null, total: row.total, createdAt: token.created_at, version: token.version,
    followups: followups.map(f => ({ id: f._id, message: f.message, createdAt: f.created_at, nextFollowupAt: f.next_followup_at || null })),
    history: [...events.map(e => ({ status: e.status || e.type, createdAt: e.created_at })),...queueEvents.map(e=>({status:`queue_${e.status}`,createdAt:e.created_at}))].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),
  };
}
export async function listTrackedServices(actor: Actor, options: { admin?: boolean; token?: string;tokenId?:string; page?: number; active?: boolean } = {}) {
  await ensureOperations(); if (options.admin) await admin(actor);
  // New bookings issue their token atomically. This bounded repair covers imports and legacy bookings.
  if (!options.admin) for (const source of ["catalog", "provider"] as const) {
    const field = source === "catalog" ? "user_id" : "customer_id";
    const rows = await (await mongoCollection(source === "catalog" ? "bookings" : "marketplace_bookings")).find({ [field]: actor.id, ...(options.active ? { status: { $nin: ["completed", "cancelled"] } } : {}) }).sort({ created_at: -1 }).limit(50).toArray();
    for (const row of rows) await issueServiceToken(source, row.id, actor.id, row.created_at);
  }
  const filter: Document = { ...(options.admin ? {} : { customer_id: actor.id }), ...(options.tokenId?{_id:options.tokenId}:options.token ? {$or:[{token:options.token.trim().toUpperCase()},{"token_history.token":options.token.trim().toUpperCase()}]} : {}) };
  const page = Math.min(400, Math.max(1, Math.trunc(options.page || 1)));
  const tokens = await mongoCollection<ServiceToken>("service_tokens");
  const pipeline: Document[] = [{ $match: filter }];
  if (options.active) pipeline.push(
    { $lookup: { from: "bookings", localField: "booking_id", foreignField: "id", as: "catalog" } },
    { $lookup: { from: "marketplace_bookings", localField: "booking_id", foreignField: "id", as: "provider" } },
    { $set: { current_status: { $cond: [{ $eq: ["$source", "catalog"] }, { $arrayElemAt: ["$catalog.status", 0] }, { $arrayElemAt: ["$provider.status", 0] }] } } },
    { $match: { current_status: { $in: ["pending", "confirmed", "in_progress", "disputed"] } } },
    { $unset: ["catalog", "provider", "current_status"] },
  );
  pipeline.push({ $facet: { rows: [{ $sort: { created_at: -1, _id: 1 } }, { $skip: (page - 1) * 20 }, { $limit: 20 }], totals: [{ $count: "count" }] } });
  const [result] = await tokens.aggregate<{ rows: ServiceToken[]; totals: { count: number }[] }>(pipeline).toArray();
  const total = result?.totals[0]?.count || 0, rows = result?.rows || [];
  const services = (await Promise.all(rows.map(trackingDetails))).filter((r): r is TrackedService => Boolean(r));
  return { services, total, page, pages: Math.max(1, Math.ceil(total / 20)) };
}
export async function listNotifications(userId: string) {
  await ensureOperations(); const notifications = await mongoCollection("customer_notifications");
  const [rows, unread] = await Promise.all([notifications.find({ user_id: userId }).sort({ created_at: -1 }).limit(50).toArray(), notifications.countDocuments({ user_id: userId, read_at: null })]);
  return { notifications: rows.map(n => ({ id: n._id, title: n.title, message: n.message, created_at: n.created_at, read_at: n.read_at || null, popup_dismissed_at: n.popup_dismissed_at || null, href: n.href, token: n.token || undefined })) as ServiceUpdate[], unread };
}
export async function acknowledgeNotification(userId: string, id: string, action: "read" | "dismiss") {
  const result = await (await mongoCollection("customer_notifications")).updateOne({ _id: id, user_id: userId }, { $set: { [action === "read" ? "read_at" : "popup_dismissed_at"]: new Date().toISOString() } });
  if (!result.matchedCount) throw new HttpError(404, "Update not found.");
}
export const userChannel = (userId: string) => `urbankare:${process.env.MONGODB_DB || "urbankare"}:updates:${userId}`;
export async function publishServiceUpdate(userId: string) {
  // Durable records are already committed; transport failure never discards an update.
  try { await (await getRedis()).publish(userChannel(userId), "updated"); } catch { /* Fetching the durable inbox still delivers it. */ }
}
const notificationSchema = z.object({ customerId: z.string().min(1).max(100), title: z.string().trim().min(3).max(100), message: z.string().trim().min(5).max(1500), token: z.string().max(60).optional(), requestKey: z.string().uuid() }).strict();
/** Display labels repeat across services. Legacy labels remain accepted only when unambiguous. */
export async function resolveServiceToken(reference:string,session?:ClientSession,customerId?:string){
  const rows=await(await mongoCollection<ServiceToken>("service_tokens")).find({...(reference.startsWith("catalog:")||reference.startsWith("provider:")?{_id:reference}:{$or:[{token:reference},{"token_history.token":reference}]}),...(customerId?{customer_id:customerId}:{})},{session}).limit(2).toArray();
  if(rows.length>1)throw new HttpError(409,"This token number belongs to more than one service. Open its booking to choose the exact service.");
  return rows[0]||null;
}
async function auditOperation(actorId: string, action: string, target: string, details: unknown, session: ClientSession) {
  const id = randomUUID(); await (await mongoCollection("platform_audit")).insertOne({ _id: id, id, actor_id: actorId, action, target_id: target, details: JSON.stringify(details), created_at: new Date().toISOString() }, { session });
}
export async function sendCustomerNotification(actor: Actor, input: unknown) {
  await admin(actor); await ensureOperations(); const parsed = notificationSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Choose a customer and write a clear title and message.");
  const data = parsed.data;
  const payloadHash = createHash("sha256").update(JSON.stringify({ customerId: data.customerId, title: data.title, message: data.message, token: data.token || null })).digest("hex");
  await withMongoTransaction(async session => {
    await transactionAdmin(actor, session);
    const requests = await mongoCollection("operation_requests");
    const previous = await requests.findOne({ actor_id: actor.id, request_key: data.requestKey }, { session });
    if (previous) { if (previous.payload_hash !== payloadHash) throw new HttpError(409, "This request key was already used for a different notification."); return; }
    if (!await (await mongoCollection("users")).findOne({ id: data.customerId }, { session })) throw new HttpError(404, "Customer not found.");
    let token: ServiceToken | null = null;
    if (data.token) { token = await resolveServiceToken(data.token,session,data.customerId); if (!token) throw new HttpError(404, "Service token does not belong to this customer."); }
    const id = randomUUID(), now = new Date().toISOString();
    await (await mongoCollection("customer_notifications")).insertOne({ _id: id, user_id: data.customerId, title: data.title, message: data.message, token: token?.token || null,token_id:token?._id||null, href: token ? `/dashboard/tracking?tokenId=${encodeURIComponent(token._id)}` : "/dashboard/updates", created_at: now, read_at: null, popup_dismissed_at: null, actor_id: actor.id }, { session });
    await requests.insertOne({ _id: `${actor.id}:${data.requestKey}`, actor_id: actor.id, request_key: data.requestKey, payload_hash: payloadHash, created_at: now }, { session });
    await auditOperation(actor.id, "notification.sent", id, { customerId: data.customerId, token: token?.token }, session);
  });
  await publishServiceUpdate(data.customerId);
}
const followupSchema = z.object({ token: z.string().min(6).max(60), version: z.number().int().nonnegative(), message: z.string().trim().min(5).max(1500), nextFollowupAt: z.string().datetime().nullable().optional(), notify: z.boolean().default(true) }).strict();
export async function addServiceFollowup(actor: Actor, input: unknown) {
  await admin(actor); await ensureOperations(); const parsed = followupSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Enter a message and a valid service token.");
  const data = parsed.data;
  if (data.nextFollowupAt && Date.parse(data.nextFollowupAt) < Date.now()) throw new HttpError(400, "Choose a future follow-up time.");
  const updatedToken = await withMongoTransaction(async session => {
    await transactionAdmin(actor, session);
    const resolved=await resolveServiceToken(data.token,session);
    const token = resolved&&await (await mongoCollection<ServiceToken>("service_tokens")).findOneAndUpdate({ _id:resolved._id, version: data.version }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
    if (!token) throw new HttpError(409, "The service was updated by someone else. Refresh before sending your follow-up.");
    const id = randomUUID(), now = new Date().toISOString();
    await (await mongoCollection("service_followups")).insertOne({ _id: id, token: token.token,token_id:token._id, actor_id: actor.id, message: data.message, next_followup_at: data.nextFollowupAt || null, created_at: now }, { session });
    if (data.notify) await (await mongoCollection("customer_notifications")).insertOne({ _id: randomUUID(), user_id: token.customer_id, title: "An update on your service", message: data.message, token: token.token, token_id:token._id, href: `/dashboard/tracking?tokenId=${encodeURIComponent(token._id)}`, created_at: now, read_at: null, popup_dismissed_at: null, actor_id: actor.id }, { session });
    await auditOperation(actor.id, "service.followup", token.token, { nextFollowupAt: data.nextFollowupAt || null }, session);
    return token;
  });
  await publishQueueBooking(updatedToken.source,updatedToken.booking_id);
}
export async function transitionTrackedBookingInSession(token:ServiceToken,status:string,actorId:string,session:ClientSession){
  if(token.source==="catalog")return transitionCatalogBookingInSession(token.booking_id,status,actorId,session);
  const bookings=await mongoCollection("marketplace_bookings");
  const row=await bookings.findOneAndUpdate({id:token.booking_id},{$inc:{state_version:1}},{session,returnDocument:"after"});
  if(!row)throw new HttpError(404,"Booking not found.");
  if(row.status===status)return;
  const allowed:Record<string,string[]>={pending:["confirmed","cancelled"],confirmed:["in_progress","cancelled"],in_progress:["completed"]};
  if(!allowed[row.status]?.includes(status))throw new HttpError(409,"This service cannot move to that status.");
  if(status==="in_progress"&&Date.now()<Date.parse(row.starts_at)-30*60000)throw new HttpError(409,"Service can start 30 minutes before its scheduled time.");
  if(status==="completed"&&Date.now()<Date.parse(row.ends_at))throw new HttpError(409,"Completion can be confirmed after the scheduled service ends.");
  const now=new Date().toISOString();await bookings.updateOne({id:row.id,status:row.status},{$set:{status}},{session});
  const id=randomUUID();await(await mongoCollection("marketplace_events")).insertOne({_id:id,id,booking_id:row.id,actor_id:actorId,status,created_at:now},{session});
  await auditOperation(actorId,"service.status",token._id,{from:row.status,to:status},session);
}
export async function updateTrackedStatus(actor: Actor, tokenCode: string, status: string) {
  await admin(actor); await ensureOperations();
  if (!/^(confirmed|in_progress|completed|cancelled)$/.test(status)) throw new HttpError(400, "Choose a valid service status.");
  const token = await withMongoTransaction(async session => {
    await transactionAdmin(actor, session);
    const token = await resolveServiceToken(tokenCode,session);
    if (!token) throw new HttpError(404, "Service token not found.");
    await transitionTrackedBookingInSession(token,status,actor.id,session);
    await syncQueueBookingStatus(token.source,token.booking_id,status,actor.id,session);
    await (await mongoCollection("customer_notifications")).updateOne({ event_key: `${token._id}:status:${status}` }, { $setOnInsert: { _id: randomUUID(), event_key: `${token._id}:status:${status}`, user_id: token.customer_id, title: "Your service status changed", message: `Service ${token.token} is now ${status.replaceAll("_", " ")}. Open your service timeline for details.`, token: token.token, token_id:token._id, href: `/dashboard/tracking?tokenId=${encodeURIComponent(token._id)}`, created_at: new Date().toISOString(), read_at: null, popup_dismissed_at: null, actor_id: actor.id } }, { upsert: true, session });
    return token;
  });
  if (token.source === "catalog" && status === "cancelled") await requestBookingRefund(token.booking_id);
  await publishQueueBooking(token.source,token.booking_id);
}
export async function recordCashReceipt(actor: Actor, tokenCode: string, receiptReference: string, amount: number) {
  await admin(actor); await ensureOperations();
  if (!/^[A-Za-z0-9 /_.-]{5,80}$/.test(receiptReference)) throw new HttpError(400, "Add a valid receipt reference of 5–80 characters.");
  const userId = await withMongoTransaction(async session => {
    await transactionAdmin(actor, session);
    const token = await resolveServiceToken(tokenCode,session);
    if (!token || token.source !== "catalog") throw new HttpError(400, "Cash collection is available for catalogue pay-after-service bookings.");
    const collection = await mongoCollection("bookings");
    const booking = await collection.findOneAndUpdate({ id: token.booking_id }, { $inc: { payment_version: 1 } }, { session, returnDocument: "after" });
    if (!booking || booking.payment !== "cash" || !["in_progress", "completed"].includes(booking.status) || booking.payment_status !== "unpaid" || amount !== booking.total) throw new HttpError(409, "Confirm the exact unpaid cash total for a service that has started.");
    const now = new Date().toISOString();
    await (await mongoCollection("cash_receipts")).insertOne({ _id: token._id, source: token.source, booking_id: token.booking_id, amount, receipt_reference: receiptReference, actor_id: actor.id, created_at: now }, { session });
    await collection.updateOne({ id: token.booking_id, payment_status: "unpaid" }, { $set: { payment_status: "paid", updated_at: now } }, { session });
    await addBookingEvent(token.booking_id, "cash.collected", { actorId: actor.id, receiptReference, amount }, session);
    await auditOperation(actor.id, "payment.cash-received", token.token, { amount, receiptReference }, session);
    return token.customer_id;
  });
  await publishServiceUpdate(userId);
}

const audienceSchema=z.object({target:z.enum(["user","service","all"]),customerId:z.string().min(1).max(100).optional(),serviceId:z.string().min(1).max(2500).optional(),title:z.string().trim().min(3).max(100),message:z.string().trim().min(5).max(1500),requestKey:z.string().uuid()}).strict();
async function deliverNotificationCampaign(campaignId:string,actor:Actor,batches=10){
  const campaigns=await mongoCollection("notification_campaigns");
  for(let batch=0;batch<batches;batch++){
    const campaign=await campaigns.findOne({_id:campaignId});if(!campaign||campaign.complete||campaign.blocked)return;
    let recipients:string[]=[];
    if(campaign.target==="service"){
      const rows=await(await mongoCollection("service_tokens")).aggregate<{_id:string}>([{$match:{$or:[{service_id:campaign.service_id},{service_ids:campaign.service_id}],customer_id:{$gt:campaign.cursor},created_at:{$lte:campaign.created_at}}},{$group:{_id:"$customer_id"}},{$sort:{_id:1}},{$limit:100}]).toArray();recipients=rows.map(row=>row._id);
    }else{
      const rows=await(await mongoCollection("users")).find({id:{$gt:campaign.cursor},created_at:{$lte:campaign.created_at},...(campaign.target==="user"?{id:campaign.customer_id}: {})},{projection:{id:1}}).sort({id:1}).limit(campaign.target==="user"?1:100).toArray();recipients=campaign.target==="user"&&campaign.cursor?[]:rows.map(row=>row.id);
    }
    const committed=await withMongoTransaction(async session=>{
      await transactionAdmin(actor,session);
      const claim=await campaigns.findOneAndUpdate({_id:campaignId,cursor:campaign.cursor,complete:false},{$inc:{version:1}},{session});if(!claim)return false;
      const now=new Date().toISOString();
      for(const userId of recipients){const eventKey=`audience:${campaignId}:${userId}`;await(await mongoCollection("customer_notifications")).updateOne({event_key:eventKey},{$setOnInsert:{_id:randomUUID(),event_key:eventKey,user_id:userId,title:campaign.title,message:campaign.message,href:"/dashboard/updates",created_at:now,read_at:null,popup_dismissed_at:null,actor_id:actor.id,campaign_id:campaignId}},{session,upsert:true});}
      await campaigns.updateOne({_id:campaignId},{$set:{cursor:recipients.at(-1)||campaign.cursor,complete:recipients.length===0,updated_at:now},$inc:{delivered:recipients.length}},{session});return true;
    });
    if(committed)await Promise.all(recipients.map(publishServiceUpdate));
  }
}
export async function sendAudienceNotification(actor:Actor,input:unknown){
  await ensureOperations();await admin(actor);const parsed=audienceSchema.safeParse(input);if(!parsed.success)throw new HttpError(400,"Choose an audience and write a clear notification.");
  const data=parsed.data;if(data.target==="user"&&!data.customerId||data.target==="service"&&!data.serviceId)throw new HttpError(400,"Choose the notification recipient or service.");
  const payloadHash=createHash("sha256").update(JSON.stringify(data)).digest("hex"),id=`${actor.id}:${data.requestKey}`;
  await withMongoTransaction(async session=>{
    await transactionAdmin(actor,session);const requests=await mongoCollection("operation_requests"),previous=await requests.findOne({actor_id:actor.id,request_key:data.requestKey},{session});
    if(previous){if(previous.payload_hash!==payloadHash)throw new HttpError(409,"This request key was already used for another notification.");return;}
    if(data.target==="user"&&!await(await mongoCollection("users")).findOne({id:data.customerId},{session}))throw new HttpError(404,"Customer not found.");
    const now=new Date().toISOString();await(await mongoCollection("notification_campaigns")).insertOne({_id:id,actor_id:actor.id,target:data.target,customer_id:data.customerId||null,service_id:data.serviceId||null,title:data.title,message:data.message,cursor:"",complete:false,delivered:0,version:0,created_at:now,updated_at:now},{session});
    await requests.insertOne({_id:id,actor_id:actor.id,request_key:data.requestKey,payload_hash:payloadHash,created_at:now},{session});await auditOperation(actor.id,"notification.audience",id,{target:data.target,serviceId:data.serviceId||null,customerId:data.customerId||null},session);
  });
  await deliverNotificationCampaign(id,actor);const result=await(await mongoCollection("notification_campaigns")).findOne({_id:id});return{complete:Boolean(result?.complete),delivered:Number(result?.delivered||0)};
}
/** Worker resumes durable fan-out after a timeout; every batch rechecks the original sender. */
export async function processPendingNotificationCampaigns(){
  await ensureOperations();
  const campaigns=await mongoCollection("notification_campaigns"),pending=await campaigns.find({complete:false,blocked:{$ne:true}}).sort({created_at:1}).limit(20).toArray();
  for(const campaign of pending){const user=await(await mongoCollection("users")).findOne({id:campaign.actor_id});try{await deliverNotificationCampaign(campaign._id,{id:campaign.actor_id,role:user?.role||""},1);}catch(error){if(error instanceof HttpError&&error.status===403)await campaigns.updateOne({_id:campaign._id},{$set:{blocked:true,updated_at:new Date().toISOString()}});else throw error;}}
  return{processed:pending.length};
}
