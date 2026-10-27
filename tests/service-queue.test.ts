import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mongoFixture } from "./helpers/mongo-fixture";
import { ensureOperations,issueServiceToken,listTrackedServices,resolveServiceToken,sendAudienceNotification,processPendingNotificationCampaigns } from "../lib/service-operations";
import { prepareQueueNumber,queueScopeId } from "../lib/queue-numbering";
import { enrollLegacyToken,listQueue,mutateQueue } from "../lib/service-queue";
import { getRedis } from "../lib/redis";
import { withMongoTransaction } from "../lib/mongo";
import { HttpError } from "../lib/http";
import { rescheduleBooking } from "../lib/reschedule";
import { ensureCatalogSlot,createCatalogBooking } from "../lib/catalog-bookings";
import { indiaDate } from "../lib/booking-rules";
import type { Document } from "mongodb";
const rejects=(status:number)=>(error:unknown)=>error instanceof HttpError&&error.status===status;

test("durable service queues keep numbering, ownership, transitions and notification audiences consistent",async t=>{
 const fixture=await mongoFixture("queue");t.after(()=>fixture.close());const {db}=fixture;
 const records=(name:string)=>db.collection<Document&{_id:string}>(name);
 for(const id of ["admin","customer-a","customer-b","professional","outsider"])await fixture.seedUser(id);
 await fixture.users.updateOne({id:"admin"},{$set:{role:"SUPER_ADMIN"}});await fixture.users.updateOne({id:"professional"},{$set:{role:"PROVIDER"}});
 const admin={id:"admin",role:"SUPER_ADMIN"},provider={id:"professional",role:"PROVIDER"},outsider={id:"outsider",role:"PROVIDER"},providerId=randomUUID(),day="2020-01-01";
 await records("marketplace_providers").insertOne({_id:providerId,id:providerId,user_id:provider.id,display_name:"Actual fixture professional",active:1});
 await ensureOperations();
 async function seedQueued(id:string,serviceId="catalog:clean",customerId="customer-a",serviceIds=["clean"],queueDay=day){
  await fixture.seedBooking(id,customerId,{payment:"cash",status:"confirmed",date:queueDay,items:JSON.stringify([{slug:serviceIds[0],title:"Fixture cleaning",price:100,qty:1,durationMin:30}])});
  const number=await prepareQueueNumber("catalog",id,serviceId,queueDay);
  return withMongoTransaction(session=>issueServiceToken("catalog",id,customerId,new Date().toISOString(),session,{...number,service_ids:serviceIds,assigned_provider_id:null,assigned_user_id:null,estimated_minutes:30}));
 }
 await t.test("concurrent Redis increments are unique and Redis loss cannot recycle durable numbers",async()=>{
  const numbers=await Promise.all(Array.from({length:20},(_,index)=>prepareQueueNumber("catalog",`number-${index}`,"numbering",day)));
  assert.equal(new Set(numbers.map(row=>row.sequence)).size,20);assert.ok(numbers.every(row=>/^TKN-20200101-\d{4,}$/.test(row.token)));
  const highest=Math.max(...numbers.map(row=>row.sequence)),redis=await getRedis(),key=`${process.env.REDIS_KEY_PREFIX}:queue:${queueScopeId("numbering",day)}`;
  await redis.del(key);const afterReset=await prepareQueueNumber("catalog","after-reset","numbering",day);assert.ok(afterReset.sequence>highest);
  await redis.set(key,"1");const afterStale=await prepareQueueNumber("catalog","after-stale","numbering",day);assert.ok(afterStale.sequence>afterReset.sequence);
  const same=await Promise.all(Array.from({length:8},()=>prepareQueueNumber("catalog","same-booking","numbering",day)));
  assert.equal(new Set(same.map(row=>row.sequence)).size,1);assert.equal(await records("queue_allocations").countDocuments({_id:"catalog:same-booking"}),1);
  await assert.rejects(()=>prepareQueueNumber("catalog","same-booking","another-service",day),rejects(409));
 });
 const first=await seedQueued("queue-one"),second=await seedQueued("queue-two","catalog:clean","customer-b"),otherService=await seedQueued("queue-other","catalog:other","customer-b",["other"]);
 await t.test("repeated display labels cannot select another booking or cross customer ownership",async()=>{
  assert.equal(first.token,otherService.token,"Each service has its own day counter");
  await assert.rejects(()=>resolveServiceToken(first.token),rejects(409));
  assert.equal((await resolveServiceToken(first._id))?.booking_id,first.booking_id);
  assert.equal((await listTrackedServices({id:"customer-a",role:"CUSTOMER"},{tokenId:otherService._id})).total,0);
  assert.equal((await listTrackedServices({id:"customer-a",role:"CUSTOMER"},{tokenId:first._id})).services[0].tokenId,first._id);
  await assert.rejects(()=>mutateQueue(outsider,{action:"start",tokenId:first._id,version:0}),rejects(404));
 });
 await t.test("call-next serializes, assignments enforce provider ownership and stale actions fail",async()=>{
  await mutateQueue(admin,{action:"assign",tokenId:first._id,version:0,providerId});
  const board=await listQueue(admin,{day,serviceId:"catalog:clean"}),queue=board.queues[0];
  const calls=await Promise.allSettled([mutateQueue(admin,{action:"call-next",serviceId:queue.serviceId,day,version:queue.version}),mutateQueue(admin,{action:"call-next",serviceId:queue.serviceId,day,version:queue.version})]);
  assert.equal(calls.filter(result=>result.status==="fulfilled").length,1);assert.ok(calls.some(result=>result.status==="rejected"&&rejects(409)(result.reason)));
  let token=(await records("service_tokens").findOne({_id:first._id}))!;
  assert.equal(token.queue_status,"called");await assert.rejects(()=>mutateQueue(provider,{action:"start",tokenId:first._id,version:0}),rejects(409));
  await mutateQueue(provider,{action:"start",tokenId:first._id,version:token.version});token=(await records("service_tokens").findOne({_id:first._id}))!;
  assert.equal((await fixture.bookings.findOne({id:first.booking_id}))?.status,"in_progress");assert.equal(token.queue_status,"in_service");assert.ok(token.started_at);assert.ok(token.wait_seconds>=0);
  await assert.rejects(()=>mutateQueue(provider,{action:"cancel",tokenId:first._id,version:token.version}),rejects(403));
  await mutateQueue(provider,{action:"complete",tokenId:first._id,version:token.version});
  assert.equal((await fixture.bookings.findOne({id:first.booking_id}))?.status,"completed");
  const done=(await records("service_tokens").findOne({_id:first._id}))!;assert.equal(done.queue_status,"completed");assert.ok(done.service_seconds>=0);
  assert.ok((await listQueue(provider,{day,provider:true})).entries.every(row=>row.assignedProviderId===providerId));
 });
 await t.test("skip moves a called token back to waiting and no-show releases the booking",async()=>{
  let token=(await records("service_tokens").findOne({_id:second._id}))!;
  await mutateQueue(admin,{action:"call",tokenId:second._id,version:token.version});token=(await records("service_tokens").findOne({_id:second._id}))!;
  await mutateQueue(admin,{action:"skip",tokenId:second._id,version:token.version});token=(await records("service_tokens").findOne({_id:second._id}))!;
  assert.equal(token.queue_status,"waiting");assert.equal(token.skipped_count,1);assert.ok(token.sort_order>second.sequence!);
  await mutateQueue(admin,{action:"no-show",tokenId:second._id,version:token.version});
  assert.equal((await records("service_tokens").findOne({_id:second._id}))?.queue_status,"no_show");assert.equal((await fixture.bookings.findOne({id:second.booking_id}))?.status,"cancelled");
 });
 await t.test("one professional cannot start concurrent appointments across separate queues",async()=>{
  const tokens=await Promise.all([seedQueued("parallel-a","catalog:parallel-a"),seedQueued("parallel-b","catalog:parallel-b")]);
  for(const token of tokens){await mutateQueue(admin,{action:"assign",tokenId:token._id,version:0,providerId});await mutateQueue(admin,{action:"call",tokenId:token._id,version:1});}
  const results=await Promise.allSettled(tokens.map(token=>mutateQueue(provider,{action:"start",tokenId:token._id,version:2})));
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.ok(results.some(result=>result.status==="rejected"&&rejects(409)(result.reason)));
  const running=await records("service_tokens").find({assigned_user_id:provider.id,queue_status:"in_service"}).toArray();assert.equal(running.length,1);
  const ongoing=await listQueue(admin,{status:"in_service"});assert.ok(ongoing.entries.some(row=>row.tokenId===running[0]._id),"Ongoing includes appointments from earlier dates");assert.ok(ongoing.entries.every(row=>row.status==="in_service"));
  await mutateQueue(provider,{action:"complete",tokenId:running[0]._id,version:running[0].version});
 });
 await t.test("rescheduling atomically moves the queue and preserves private historical references",async()=>{
  const from=indiaDate(3),to=indiaDate(4),token=await seedQueued("reschedule","catalog:clean","customer-a",["clean"],from);
  await ensureCatalogSlot(from,"09:00 AM");await records("slot_inventory").updateOne({date:from,slot:"09:00 AM"},{$inc:{reserved:1}});
  await rescheduleBooking(token.booking_id,"customer-a",to,"11:00 AM");
  const moved=(await records("service_tokens").findOne({_id:token._id}))!;assert.equal(moved.queue_day,to);assert.match(moved.token,new RegExp(`^TKN-${to.replaceAll("-","")}-`));assert.equal(moved.queue_status,"waiting");assert.equal(moved.token_history[0].token,token.token);
  assert.equal((await fixture.bookings.findOne({id:token.booking_id}))?.date,to);assert.equal((await records("slot_inventory").findOne({date:from,slot:"09:00 AM"}))?.reserved,0);assert.equal((await records("slot_inventory").findOne({date:to,slot:"11:00 AM"}))?.reserved,1);
  assert.equal((await listQueue(admin,{day:from})).entries.some(row=>row.tokenId===token._id),false);assert.equal((await listQueue(admin,{day:to})).entries.some(row=>row.tokenId===token._id),true);
  assert.equal((await listTrackedServices({id:"customer-a",role:"CUSTOMER"},{token:token.token})).services[0].tokenId,token._id);assert.equal((await listTrackedServices({id:"customer-b",role:"CUSTOMER"},{token:token.token})).total,0);
  await rescheduleBooking(token.booking_id,"customer-a",to,"11:00 AM");assert.equal((await records("slot_inventory").findOne({date:to,slot:"11:00 AM"}))?.reserved,1,"Same-slot retry must not reserve again");
  const failedDay=indiaDate(5);await ensureCatalogSlot(failedDay,"11:00 AM");await records("slot_inventory").updateOne({date:failedDay,slot:"11:00 AM"},{$set:{reserved:25}});
  await assert.rejects(()=>rescheduleBooking(token.booking_id,"customer-a",failedDay,"11:00 AM"),rejects(409));assert.equal((await records("service_tokens").findOne({_id:token._id}))?.queue_day,to);assert.equal((await fixture.bookings.findOne({id:token.booking_id}))?.date,to);
  await records("service_tokens").updateOne({_id:token._id},{$set:{queue_status:"in_service"}});
  await assert.rejects(()=>rescheduleBooking(token.booking_id,"customer-a",indiaDate(6),"11:00 AM"),rejects(409));assert.equal((await records("slot_inventory").findOne({date:indiaDate(6),slot:"11:00 AM"}))?.reserved,0,"A queue failure rolls back the earlier slot reservation");assert.equal((await records("slot_inventory").findOne({date:to,slot:"11:00 AM"}))?.reserved,1);assert.equal((await fixture.bookings.findOne({id:token.booking_id}))?.date,to);
  await records("service_tokens").updateOne({_id:token._id},{$set:{queue_status:"waiting"}});
 });
 await t.test("rescheduling legacy bookings preserves the issued UK token",async()=>{
  const from=indiaDate(3),to=indiaDate(4);await fixture.seedBooking("reschedule-legacy","customer-a",{payment:"cash",status:"confirmed",date:from,items:JSON.stringify([{slug:"clean",title:"Fixture cleaning",price:100,qty:1,durationMin:30}])});
  const token=await issueServiceToken("catalog","reschedule-legacy","customer-a",new Date().toISOString());await rescheduleBooking("reschedule-legacy","customer-a",to,"01:00 PM");const moved=(await records("service_tokens").findOne({_id:token._id}))!;assert.equal(moved.token,token.token);assert.equal(moved.queue_day,to);assert.ok(moved.sequence);
 });
 await t.test("legacy references remain unchanged when enrolled",async()=>{
  await fixture.seedBooking("legacy","customer-a",{date:day,payment:"cash",status:"confirmed",items:"[]"});
  const legacy=await issueServiceToken("catalog","legacy","customer-a",new Date().toISOString());assert.match(legacy.token,/^UK-/);
  const enrolled=await enrollLegacyToken(legacy);assert.equal(enrolled.token,legacy.token);assert.equal(enrolled.queue_status,"waiting");assert.ok(enrolled.sequence);
 });
 await t.test("service notifications include bundled bookings exactly once and replay safely",async()=>{
  await seedQueued("bundle-a","catalog:clean+extra","customer-a",["clean","extra"]);await seedQueued("bundle-repeat","catalog:extra","customer-a",["extra"]);await seedQueued("bundle-b","catalog:extra","customer-b",["extra"]);
  const input={target:"service",serviceId:"extra",title:"Service update",message:"Your extra service has updated arrival guidance.",requestKey:randomUUID()};
  assert.deepEqual(await sendAudienceNotification(admin,input),{complete:true,delivered:2});assert.deepEqual(await sendAudienceNotification(admin,input),{complete:true,delivered:2});
  const messages=await records("customer_notifications").find({campaign_id:`admin:${input.requestKey}`}).toArray();assert.equal(messages.length,2);assert.deepEqual(new Set(messages.map(row=>row.user_id)),new Set(["customer-a","customer-b"]));
  await assert.rejects(()=>sendAudienceNotification(admin,{...input,message:"A different message with the same key."}),rejects(409));
 });
 await t.test("catalogue booking rechecks deactivation inside the reservation transaction",async()=>{
  await records("platform_account_status").insertOne({_id:"customer-b",user_id:"customer-b",active:0});
  const count=await fixture.bookings.countDocuments({user_id:"customer-b"}),date=indiaDate(7);
  try{await assert.rejects(()=>createCatalogBooking("customer-b",{items:[{slug:"bathroom-deep-cleaning",qty:1}],name:"QA Customer",phone:"9876543210",address:"QA apartment in Bengaluru 560001",date,slot:"09:00 AM",payment:"cash"},randomUUID()),rejects(403));
    assert.equal(await fixture.bookings.countDocuments({user_id:"customer-b"}),count);assert.equal((await records("slot_inventory").findOne({date,slot:"09:00 AM"}))?.reserved,0);
  }finally{await records("platform_account_status").deleteOne({_id:"customer-b"});}
 });
 await t.test("deactivation blocks queue changes and stops pending notification fan-out",async()=>{
  await records("platform_account_status").insertOne({_id:"admin",user_id:"admin",active:0});
  await assert.rejects(()=>mutateQueue(admin,{action:"call",tokenId:otherService._id,version:0}),rejects(403));
  await records("notification_campaigns").insertOne({_id:"revoked-campaign",actor_id:"admin",target:"all",cursor:"",complete:false,delivered:0,version:0,created_at:new Date().toISOString(),title:"Should not send",message:"This sender was disabled before delivery."});
  await processPendingNotificationCampaigns();assert.equal((await records("notification_campaigns").findOne({_id:"revoked-campaign"}))?.blocked,true);assert.equal(await records("customer_notifications").countDocuments({campaign_id:"revoked-campaign"}),0);
 });
});
