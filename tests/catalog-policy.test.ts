import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mongoFixture } from "./helpers/mongo-fixture";
import { quoteServices, assertCategoriesBookable } from "../lib/quote";
import { adminMutation } from "../lib/platform";
import { indiaDate } from "../lib/booking-rules";
import { withMongoTransaction } from "../lib/mongo";
import { readServices } from "../lib/db";
import { syncAuthoredCatalog } from "../scripts/sync-catalog";
import { cleanupMarketplaceQa } from "../scripts/cleanup-marketplace-qa";
import { mongoCollection } from "../lib/mongo";

test("Mongo catalog policies read fresh values and authored sync preserves administrator controls",async()=>{
  const fixture=await mongoFixture("catalogpolicy",{catalog:true});process.env.REDIS_URL="redis://127.0.0.1:6380";
  const admin=randomUUID();await fixture.seedUser(admin);await fixture.users.updateOne({id:admin},{$set:{role:"admin"}});
  const actor={id:admin,role:"admin"},date=indiaDate(3),categories=fixture.db.collection("categories"),services=fixture.db.collection("services");
  try{
    const original=await quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date);
    assert.equal(original.subtotal,549);assert.equal(original.discount,55);assert.equal(original.visitFee,49);assert.equal(original.total,543);
    await adminMutation(actor,{action:"config",key:"catalog_discount_percent",value:"0"});
    await adminMutation(actor,{action:"config",key:"catalog_visit_fee",value:"75"});
    await adminMutation(actor,{action:"config",key:"catalog_fee_waiver_threshold",value:"1200"});
    const updated=await quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date);assert.equal(updated.discount,0);assert.equal(updated.visitFee,75);assert.equal(updated.total,624);
    const waived=await quoteServices([{slug:"bathroom-deep-cleaning",qty:3}],date);assert.equal(waived.visitFee,0);assert.equal(waived.total,1647);
    await assert.rejects(()=>adminMutation(actor,{action:"config",key:"catalog_discount_percent",value:"101"}),/between 0 and 100/);
    const category=await categories.findOne({slug:"home-cleaning"});assert.ok(category);
    const payload=category.payload as Record<string,unknown>;
    const editCategory=(active:boolean,archived=false)=>adminMutation(actor,{action:"category",slug:"home-cleaning",name:payload.name,tagline:payload.tagline,active,archived});
    assert.ok((await readServices("home-cleaning")).length>0,"Prime the public catalog cache");
    await editCategory(false);
    assert.equal((await readServices("home-cleaning")).length,0,"Admin edits invalidate previously cached catalog pages");
    await assert.rejects(()=>quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date),/no longer accepting/);
    await assert.rejects(()=>withMongoTransaction(session=>assertCategoriesBookable(["home-cleaning"],session)),/no longer accepting/);
    await editCategory(true,true);
    await assert.rejects(()=>quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date),/no longer accepting/);
    await editCategory(true,false);assert.equal((await quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date)).total,624);
    await adminMutation(actor,{action:"service-price",slug:"bathroom-deep-cleaning",price:799});
    assert.equal((await quoteServices([{slug:"bathroom-deep-cleaning",qty:1}],date)).subtotal,799,"Quotes never reuse a stale cached price");
    await categories.updateOne({slug:"home-cleaning"},{$set:{"payload.active":false,"payload.archived":true,"payload.name":"Admin Cleaning Name","payload.tagline":"Admin supplied description"}});
    await services.updateOne({slug:"bathroom-deep-cleaning"},{$set:{active:false,archived:true,deleted:true,"payload.active":false,"payload.archived":true,"payload.deleted":true}});
    await syncAuthoredCatalog();
    const retainedCategory=await categories.findOne({slug:"home-cleaning"}),retainedService=await services.findOne({slug:"bathroom-deep-cleaning"});
    assert.equal(retainedCategory?.payload.active,false);assert.equal(retainedCategory?.payload.archived,true);assert.equal(retainedCategory?.payload.name,"Admin Cleaning Name");assert.equal(retainedCategory?.payload.tagline,"Admin supplied description");
    assert.equal(retainedService?.price,799);assert.equal(retainedService?.active,false);assert.equal(retainedService?.archived,true);assert.equal(retainedService?.deleted,true);assert.equal(retainedService?.payload.deleted,true);
    assert.equal((await readServices("home-cleaning")).length,0,"Content sync cannot republish an archived category or deleted service");
  }finally{await fixture.close();}
});

test("QA cleanup only revokes exact generated example.test accounts",async()=>{
  const fixture=await mongoFixture("qacleanup");
  const sessions=await mongoCollection("sessions"),providers=await mongoCollection("marketplace_providers");
  const addresses=["qa-marketplace-admin-1792920000000@example.test","qa-marketplace-admin-1792920000000@example.com","qa-marketplace-admin-real@example.test","qa-marketplace-provider-1792920000000@example.test","qa-marketplace-provider-real@example.test"];
  const ids=addresses.map(()=>randomUUID());
  try{
    for(let index=0;index<ids.length;index++){
      const id=ids[index];await fixture.seedUser(id,addresses[index]);await fixture.users.updateOne({id},{$set:{role:"admin"}});
      await sessions.insertOne({_id:id,token_hash:id,user_id:id,expires_at:"2030-01-01T00:00:00.000Z"});
      await providers.insertOne({_id:id,id,user_id:id,active:1,verified:1});
    }
    assert.deepEqual(await cleanupMarketplaceQa(),{revoked:1,withdrawn:1});
    assert.equal((await fixture.users.findOne({id:ids[0]}))?.role,"customer");assert.equal(await sessions.countDocuments({user_id:ids[0]}),0);
    for(const index of [1,2,3,4])assert.equal((await fixture.users.findOne({id:ids[index]}))?.role,"admin");
    assert.equal((await providers.findOne({id:ids[3]}))?.active,0);assert.equal((await providers.findOne({id:ids[3]}))?.verified,0);
    for(const index of [0,1,2,4])assert.equal((await providers.findOne({id:ids[index]}))?.active,1);
    assert.equal(await fixture.users.countDocuments(),5,"Cleanup never deletes accounts");
  }finally{await fixture.close();}
});
