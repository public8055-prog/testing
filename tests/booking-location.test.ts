import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mongoFixture} from "./helpers/mongo-fixture";
import {mutateBookingLocation,readBookingLocation,sharedPosition,type BookingLocationShare} from "../lib/booking-location";
import type {Document} from "mongodb";
import {directionsUrl} from "../lib/location-types";
import {HttpError} from "../lib/http";
const rejects=(status:number)=>(error:unknown)=>error instanceof HttpError&&error.status===status;

test("booking locations preserve consent, assignment, last known points and revocation under concurrent writes",async t=>{
  const fixture=await mongoFixture("location");t.after(()=>fixture.close());const db=fixture.db;
  for(const id of ["customer","other","provider","replacement","admin"])await fixture.seedUser(id);
  await fixture.users.updateOne({id:"admin"},{$set:{role:"SUPER_ADMIN"}});
  for(const id of ["provider","replacement"])await fixture.users.updateOne({id},{$set:{role:"PROVIDER"}});
  const customer={id:"customer",role:"CUSTOMER"},provider={id:"provider",role:"PROVIDER"},admin={id:"admin",role:"SUPER_ADMIN"},outsider={id:"other",role:"SUPER_ADMIN"};
  for(const id of ["provider","replacement"])await db.collection("marketplace_providers").insertOne({id,user_id:id,active:1,display_name:`QA ${id}`});
  await fixture.seedBooking("location-booking",customer.id,{status:"confirmed",address:"Original service address, Delhi 110001"});
  await db.collection<Document&{_id:string}>("service_tokens").insertOne({_id:"catalog:location-booking",token:"TKN-20261026-0001",booking_id:"location-booking",source:"catalog",assigned_provider_id:"provider",assigned_user_id:"provider"});
  const read=(actor=customer)=>readBookingLocation(actor,"catalog","location-booking");
  const write=(actor:typeof customer,data:unknown)=>mutateBookingLocation(actor,"catalog","location-booking",data);
  const point=(offset=0)=>({latitude:28.6139+offset/1000,longitude:77.209,accuracy:8,observedAt:new Date(Date.now()+offset).toISOString()});
  let session=randomUUID();const professionalSession=randomUUID();

  await t.test("database ownership defeats spoofed roles, other accounts and token-label guessing",async()=>{
    await assert.rejects(read(outsider),rejects(404));
    await assert.rejects(readBookingLocation(customer,"catalog","TKN-20261026-0001"),rejects(404));
    assert.equal((await read(provider)).viewer,"provider");assert.equal((await read(admin)).viewer,"admin");
    assert.equal(await db.collection("booking_location_access").countDocuments({actor_id:admin.id}),1);
    await read(admin);assert.equal(await db.collection("booking_location_access").countDocuments({actor_id:admin.id}),1);
  });
  await t.test("address edits require actual customer consent and reject invalid coordinates",async()=>{
    const input={action:"site",address:"Updated service address, Delhi 110001",landmark:"Gate 2, ring the bell",pin:{latitude:28.61,longitude:77.2},version:0,consent:true};
    await assert.rejects(write(customer,{...input,consent:false}),rejects(400));
    await assert.rejects(write(customer,{...input,pin:{latitude:100,longitude:77}}),rejects(400));
    await assert.rejects(write(provider,input),rejects(403));await assert.rejects(write(admin,input),rejects(403));
    const results=await Promise.allSettled([write(customer,input),write(customer,{...input,address:"Another service address, Delhi 110002"})]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
    assert.equal((await read()).version,1);assert.equal((await read()).landmark,input.landmark);
    await assert.rejects(write(customer,input),rejects(409));
  });
  await t.test("explicit consent starts own GPS only; both assigned participants and admin can read shared points",async()=>{
    await assert.rejects(write(customer,{action:"start",sessionId:session,consent:false}),rejects(400));
    await assert.rejects(write(admin,{action:"start",sessionId:randomUUID(),consent:true}),rejects(403));
    await write(customer,{action:"start",sessionId:session,consent:true});await write(provider,{action:"start",sessionId:professionalSession,consent:true});
    await write(customer,{action:"position",sessionId:session,sequence:1,point:point()});
    await write(provider,{action:"position",sessionId:professionalSession,sequence:1,point:point(10)});
    for(const actor of [customer,provider,admin]){const data=await read(actor);assert.equal(data.customer.location.state,"recent");assert.equal(data.provider?.location.state,"recent");}
    await assert.rejects(write(provider,{action:"position",sessionId:session,sequence:2,point:point()}),rejects(409));
    await assert.rejects(write(customer,{action:"position",sessionId:session,sequence:2,point:point(),userId:provider.id}),rejects(400));
  });
  await t.test("out-of-order, stale and future fixes cannot replace the latest position",async()=>{
    const results=await Promise.allSettled(Array.from({length:8},(_,index)=>write(customer,{action:"position",sessionId:session,sequence:index+2,point:point(1000+index*100)})));
    assert.ok(results.some(result=>result.status==="fulfilled"));
    const latest=(await read()).customer.location.point!;assert.equal(latest.latitude,point(1700).latitude);
    await assert.rejects(write(customer,{action:"position",sessionId:session,sequence:2,point:point()}),rejects(409));
    for(const observedAt of [new Date(Date.now()-180000).toISOString(),new Date(Date.now()+60000).toISOString()])await assert.rejects(write(customer,{action:"position",sessionId:session,sequence:20,point:{...point(),observedAt}}),rejects(400));
  });
  await t.test("closing atomically saves the final fix and retains address plus timestamp after sharing stops",async()=>{
    const finalPoint=point(3000);await write(customer,{action:"stop",sessionId:session,reason:"page_closed",finalPosition:{sequence:30,point:finalPoint}});
    const data=await read(provider);assert.equal(data.customer.location.state,"last_known");assert.equal(data.customer.location.point?.latitude,finalPoint.latitude);assert.equal(data.customer.location.stoppedReason,"page_closed");assert.ok(data.address.includes("11000"));
    const notification=await db.collection("customer_notifications").findOne({user_id:provider.id,title:"Last shared location saved"});assert.ok(notification);assert.equal(notification.href,"/locations/catalog/location-booking");assert.equal(notification.message.includes(String(finalPoint.latitude)),false);
    await write(customer,{action:"stop",sessionId:session,reason:"page_closed"});assert.equal(await db.collection("customer_notifications").countDocuments({user_id:provider.id,title:"Last shared location saved"}),1);
    await assert.rejects(write(customer,{action:"position",sessionId:session,sequence:31,point:point(4000)}),rejects(409));
  });
  await t.test("a stale browser cannot stop a replacement sharing session",async()=>{
    const old=session;session=randomUUID();await write(customer,{action:"start",sessionId:session,consent:true});
    await assert.rejects(write(customer,{action:"stop",sessionId:old,reason:"page_closed"}),rejects(409));
    await write(customer,{action:"position",sessionId:session,sequence:1,point:point(5000)});assert.equal((await read()).customer.location.state,"recent");
  });
  await t.test("loss of connection becomes last-known without requiring a close beacon; expired data is hidden before TTL cleanup",async()=>{
    const now=Date.now(),row=await db.collection<BookingLocationShare>("booking_location_shares").findOne({user_id:customer.id});assert.ok(row?.point);
    assert.equal(sharedPosition({...row,point:{...row.point,receivedAt:new Date(now-91000).toISOString()}},true,now).state,"last_known");
    assert.equal(sharedPosition({...row,expires_at:new Date(now-1)},true,now).point,null);
    await db.collection("booking_location_shares").updateOne({user_id:customer.id},{$set:{sharing_until:new Date(now-1)}});
    await assert.rejects(write(customer,{action:"position",sessionId:session,sequence:2,point:point(6000)}),rejects(409));
  });
  await t.test("reassignment immediately removes the previous vendor's access and excludes their location",async()=>{
    await db.collection<Document&{_id:string}>("service_tokens").updateOne({_id:"catalog:location-booking"},{$set:{assigned_provider_id:"replacement",assigned_user_id:"replacement"}});
    await assert.rejects(read(provider),rejects(404));await assert.rejects(write(provider,{action:"position",sessionId:professionalSession,sequence:2,point:point()}),rejects(404));
    assert.equal((await read()).provider?.location.point,null);assert.equal((await read({id:"replacement",role:"PROVIDER"})).viewer,"provider");
  });
  await t.test("restarting sharing neither extends an old GPS retention deadline nor resurrects an expired point",async()=>{
    const shares=db.collection<BookingLocationShare>("booking_location_shares"),deadline=new Date(Date.now()+30000);
    await shares.updateOne({user_id:customer.id},{$set:{expires_at:deadline}});session=randomUUID();
    await write(customer,{action:"start",sessionId:session,consent:true});assert.equal((await shares.findOne({user_id:customer.id}))!.expires_at.getTime(),deadline.getTime());
    await shares.updateOne({user_id:customer.id},{$set:{expires_at:new Date(Date.now()-1)}});session=randomUUID();
    await write(customer,{action:"start",sessionId:session,consent:true});assert.equal((await read()).customer.location.point,null);
    await write(customer,{action:"position",sessionId:session,sequence:1,point:point(7000)});
  });
  await t.test("finished work disables tracking and customer removal revokes stored GPS without deleting service address",async()=>{
    await fixture.bookings.updateOne({id:"location-booking"},{$set:{status:"completed"}});
    assert.equal((await read()).canShare,false);assert.equal((await read()).customer.location.state,"last_known");
    await assert.rejects(read({id:"replacement",role:"PROVIDER"}),rejects(404));
    await assert.rejects(write(customer,{action:"start",sessionId:randomUUID(),consent:true}),rejects(409));
    await write(customer,{action:"forget"});const data=await read(admin);assert.equal(data.customer.location.point,null);assert.ok(data.address);
    await fixture.users.updateOne({id:admin.id},{$set:{role:"CUSTOMER"}});await assert.rejects(read(admin),rejects(404));
  });
  await t.test("marketplace bookings also use their current provider assignment and account status",async()=>{
    await db.collection("marketplace_bookings").insertOne({id:"market-location",customer_id:customer.id,provider_id:"provider",address:"Provider service address 110001",status:"confirmed"});
    assert.equal((await readBookingLocation(provider,"provider","market-location")).viewer,"provider");
    await fixture.users.updateOne({id:provider.id},{$set:{disabled:true}});await assert.rejects(readBookingLocation(provider,"provider","market-location"),rejects(401));
  });
  assert.ok(directionsUrl("Gate & entrance / Delhi 110001").includes("destination=Gate+%26+entrance"));
});
