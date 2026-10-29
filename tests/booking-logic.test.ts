import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mongoFixture } from "./helpers/mongo-fixture";
import { quoteServices } from "../lib/quote";
import { rescheduleBooking } from "../lib/reschedule";
import { createCatalogBooking, cancelCatalogBooking, ensureCatalogSlot } from "../lib/catalog-bookings";
import { indiaDate, checkoutSchema, isBookableSlot } from "../lib/booking-rules";

test("Mongo quotes, price-change protection, booking replay and rescheduling preserve capacity and payment",async()=>{
  const fixture=await mongoFixture("bookinglogic",{catalog:true});
  const slots=fixture.db.collection("slot_inventory"),services=fixture.db.collection("services"),tokens=fixture.db.collection("service_tokens");
  const customer=randomUUID();await fixture.seedUser(customer);
  try{
    const date=indiaDate(3),nextDate=indiaDate(4);
    const quote=await quoteServices([{slug:"bathroom-deep-cleaning",qty:2}],date);
    assert.equal(quote.subtotal,1098);assert.equal(quote.discount,110);assert.equal(quote.visitFee,0);assert.equal(quote.total,988);assert.equal(quote.durationMin,120);
    assert.equal(isBookableSlot(date,"07:00 PM",180),false);assert.equal(isBookableSlot(date,"05:00 PM",180),true);
    await assert.rejects(()=>quoteServices([{slug:"bathroom-deep-cleaning",qty:10},{slug:"mens-haircut-beard",qty:1}],date),/10 hours/);
    await assert.rejects(()=>quoteServices([{slug:"does-not-exist",qty:1}],date),/no longer available/);
    const input={items:[{slug:"bathroom-deep-cleaning",qty:1}],name:"QA Customer",phone:"9876543210",address:"Apartment 10, New Delhi 110001",date,slot:"11:00 AM" as const,payment:"cash" as const,expectedTotal:543};
    assert.equal(checkoutSchema.safeParse({...input,address:"Missing postal address"}).success,false);
    assert.equal(checkoutSchema.safeParse({...input,items:[{slug:"bathroom-deep-cleaning",qty:1.2}]}).success,false);
    await services.updateOne({slug:"bathroom-deep-cleaning"},{$set:{price:600}});
    await assert.rejects(()=>createCatalogBooking(customer,input,randomUUID()),/price changed/);
    assert.equal((await slots.findOne({date,slot:input.slot}))?.reserved,0,"Rejected stale quote reserves no capacity");
    assert.equal(await fixture.bookings.countDocuments(),0);assert.equal(await tokens.countDocuments(),0);
    await services.updateOne({slug:"bathroom-deep-cleaning"},{$set:{price:549}});
    const key=randomUUID(),created=await createCatalogBooking(customer,input,key),id=created.booking.id;
    assert.equal(created.booking.total,543);assert.equal(created.replayed,false);assert.equal(await tokens.countDocuments({source:"catalog",booking_id:id}),1);
    await services.updateOne({slug:"bathroom-deep-cleaning"},{$set:{price:700}});
    const replay=await createCatalogBooking(customer,input,key);assert.equal(replay.replayed,true);assert.equal(replay.booking.id,id);assert.equal(replay.booking.total,543);
    assert.equal((await slots.findOne({date,slot:input.slot}))?.reserved,1);assert.equal(await tokens.countDocuments({booking_id:id}),1);
    await assert.rejects(()=>createCatalogBooking(customer,{...input,address:"Different address, New Delhi 110001"},key),/different booking details/);
    const moved=await rescheduleBooking(id,customer,nextDate,"01:00 PM");
    assert.equal(moved?.date,nextDate);assert.equal(moved?.total,543);assert.equal(moved?.paymentStatus,"unpaid");
    assert.equal((await slots.findOne({date,slot:input.slot}))?.reserved,0);
    await ensureCatalogSlot(nextDate,"03:00 PM");await slots.updateOne({date:nextDate,slot:"03:00 PM"},{$set:{reserved:25}});
    await assert.rejects(()=>rescheduleBooking(id,customer,nextDate,"03:00 PM"),/filled up/);
    assert.equal((await fixture.bookings.findOne({id}))?.slot,"01:00 PM");assert.equal((await slots.findOne({date:nextDate,slot:"01:00 PM"}))?.reserved,1);
    await assert.rejects(()=>rescheduleBooking(id,"another-user",nextDate,"09:00 AM"),/not found/);
    await Promise.all([cancelCatalogBooking(id,customer),cancelCatalogBooking(id,customer)]);
    assert.equal((await slots.findOne({date:nextDate,slot:"01:00 PM"}))?.reserved,0,"Concurrent cancellations release exactly once");
    assert.equal(await fixture.db.collection("booking_events").countDocuments({booking_id:id,type:"cancelled"}),1);
    await assert.rejects(()=>rescheduleBooking(id,customer,nextDate,"09:00 AM"),/no longer/);
  }finally{await fixture.close();}
});
