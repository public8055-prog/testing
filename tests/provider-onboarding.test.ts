import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {mongoFixture} from "./helpers/mongo-fixture";
import {addAdminProvider} from "../lib/admin-providers";
import {adminManagementMutation,submitProviderDocument,listProviderDocuments} from "../lib/admin-management";
import {adminActivity,ensureActivityIndexes} from "../lib/admin-activity";
import {storeUpload} from "../lib/uploads";
import {reviewLegacyProviderIdentity} from "../lib/provider-identity";
import {checkPassword} from "../lib/password-hashing";
import {HttpError} from "../lib/http";
import {seedTestCategory} from "./helpers/catalog-fixture";
const status=(value:number)=>(error:unknown)=>error instanceof HttpError&&error.status===value;
test("administrator vendor onboarding and platform oversight enforce private identity evidence",async t=>{
  const f=await mongoFixture("onboarding");t.after(()=>f.close());const db=f.db;
  await seedTestCategory(db);
  await f.seedUser("admin");await f.users.updateOne({id:"admin"},{$set:{role:"ADMIN"}});await f.seedUser("customer");await f.seedUser("vendor");
  const admin={id:"admin",role:"ADMIN"},fake={id:"customer",role:"ADMIN"};
  const category=await db.collection("categories").findOne({});assert.ok(category);
  const profile={display_name:"QA Added Vendor",category:String(category.slug),city:"Delhi",description:"A complete vendor profile for controlled identity onboarding tests.",skills:"Home services",experience:3,hourly_rate:100,daily_rate:800,monthly_rate:16000,opening_hour:8,closing_hour:18};
  const bytes=await sharp({create:{width:100,height:100,channels:3,background:"#335766"}}).png().toBuffer();
  const upload=()=>storeUpload({ownerUserId:"admin",purpose:"provider-document",documentType:"identity",originalName:"qa-photo.png",bytes});
  const identity={identityKind:"masked_aadhaar",consent:true,redacted:true},initial=await upload();
  const input={mode:"existing",email:"vendor@example.test",profile,uploadId:initial.id,identity,consentReference:"QA written permission recorded"};
  let providerId="",documentId="";
  await t.test("forged role, missing consent and foreign upload are rejected without creating an application",async()=>{
    await assert.rejects(addAdminProvider(fake,input),status(403));
    await assert.rejects(addAdminProvider(admin,{...input,identity:{...identity,consent:false}}),status(400));
    const foreign=await storeUpload({ownerUserId:"customer",purpose:"provider-document",documentType:"identity",originalName:"foreign.png",bytes});
    await assert.rejects(addAdminProvider(admin,{...input,uploadId:foreign.id}),status(400));
    assert.equal(await db.collection("marketplace_providers").countDocuments({user_id:"vendor"}),0);
  });
  await t.test("adding a vendor transfers private evidence ownership but never publishes or approves",async()=>{
    const added=await addAdminProvider(admin,input);providerId=added.id;assert.equal(added.status,"pending");
    const provider=await db.collection("marketplace_providers").findOne({id:providerId});assert.equal(provider!.active,0);assert.equal(provider!.verified,0);
    assert.equal((await db.collection("uploads").findOne({id:initial.id}))!.ownerUserId,"vendor");
    const documents=await listProviderDocuments("vendor");documentId=documents.documents[0].id;assert.equal(documents.documents[0].identityKind,"masked_aadhaar");
    await assert.rejects(addAdminProvider(admin,input),status(409));
    const audit=await db.collection("platform_audit").findOne({action:"provider.created",target_id:providerId});assert.ok(audit);assert.equal(String(audit.details).includes("password"),false);
  });
  await t.test("only a real administrator can review and approval requires identity masking/name checks",async()=>{
    await assert.rejects(adminManagementMutation({id:"vendor",role:"ADMIN"},{action:"provider-status",id:providerId,status:"approved",reason:"Attempt self approval"}),status(403));
    await assert.rejects(adminManagementMutation(admin,{action:"provider-status",id:providerId,status:"approved",reason:"Cannot skip document review"}),status(409));
    await assert.rejects(adminManagementMutation(admin,{action:"provider-document-review",id:documentId,status:"approved",reason:"Missing manual identity checks"}),status(400));
    await adminManagementMutation(admin,{action:"provider-document-review",id:documentId,status:"approved",identityChecked:true,reason:"QA masked photo and name checked"});
    await adminManagementMutation(admin,{action:"provider-status",id:providerId,status:"approved",reason:"QA complete application approved"});
    assert.equal((await db.collection("marketplace_providers").findOne({id:providerId}))!.active,1);
  });
  await t.test("new vendor accounts use hashed passwords; duplicates and blocked targets cannot be onboarded",async()=>{
    const password=`QA-${randomUUID()}!`,photo=await upload();
    const added=await addAdminProvider(admin,{...input,mode:"new",email:`${randomUUID()}@example.test`,initialPassword:password,uploadId:photo.id,identity:{...identity,identityKind:"driving_licence"}});
    const user=await db.collection("users").findOne({id:added.userId});assert.equal(user!.role,"PROVIDER");assert.equal(user!.email_verified,0);assert.notEqual(user!.password_hash,password);assert.equal(await checkPassword(password,String(user!.password_hash)),true);
    assert.equal(JSON.stringify(await adminActivity(admin,{})).includes(password),false);
    await adminManagementMutation(admin,{action:"account",id:"customer",active:false,reason:"QA blocked account"});
    await assert.rejects(addAdminProvider(admin,{...input,email:"customer@example.test",uploadId:(await upload()).id}),status(409));
  });
  await t.test("document replacement needs renewed consent, rejects PDFs, and returns approved vendors to pending",async()=>{
    const pdf=await storeUpload({ownerUserId:"vendor",purpose:"provider-document",documentType:"identity",originalName:"not-a-photo.pdf",bytes:Buffer.from("%PDF-1.4\n%%EOF\n")});
    await assert.rejects(submitProviderDocument("vendor",{uploadId:pdf.id,...identity}),status(400));
    const replacement=await storeUpload({ownerUserId:"vendor",purpose:"provider-document",documentType:"identity",originalName:"replacement.png",bytes});
    await assert.rejects(submitProviderDocument("vendor",{uploadId:replacement.id}),status(400));
    await submitProviderDocument("vendor",{uploadId:replacement.id,...identity});
    const provider=await db.collection("marketplace_providers").findOne({id:providerId});assert.equal(provider!.active,0);assert.equal(provider!.verification_status,"pending");
    await assert.rejects(adminManagementMutation(admin,{action:"provider-document-review",id:documentId,status:"approved",identityChecked:true,reason:"Stale document review should fail"}),status(409));
  });
  await t.test("rejection, suspension and account blocking prevent publication; unblock alone never approves",async()=>{
    for(const state of ["rejected","suspended"]){await adminManagementMutation(admin,{action:"provider-status",id:providerId,status:state,reason:"QA administrator decision"});assert.equal((await db.collection("marketplace_providers").findOne({id:providerId}))!.active,0);}
    await adminManagementMutation(admin,{action:"account",id:"vendor",active:false,reason:"QA vendor account blocked"});
    await assert.rejects(submitProviderDocument("vendor",{uploadId:(await storeUpload({ownerUserId:"vendor",purpose:"provider-document",documentType:"identity",originalName:"blocked.png",bytes})).id,...identity}),status(403));
    await adminManagementMutation(admin,{action:"account",id:"vendor",active:true,reason:"QA restored account only"});assert.equal((await db.collection("marketplace_providers").findOne({id:providerId}))!.active,0);
  });
  await t.test("legacy active profiles without valid photos return to review without changing bookings",async()=>{
    await db.collection("marketplace_providers").updateOne({id:providerId},{$set:{active:1}});await f.seedBooking("retained-booking","customer");
    assert.ok(await reviewLegacyProviderIdentity()>=1);assert.equal((await db.collection("marketplace_providers").findOne({id:providerId}))!.active,0);assert.ok(await f.bookings.findOne({id:"retained-booking"}));
    assert.equal(await reviewLegacyProviderIdentity(),0);
  });
  await t.test("activity is paginated, filtered, role protected and excludes private raw payloads",async()=>{
    await ensureActivityIndexes();await assert.rejects(adminActivity(fake,{}),status(403));
    const now=new Date().toISOString();await db.collection("queue_events").insertMany(Array.from({length:35},(_,i)=>({token_id:`QA-${i}`,action:"called",created_at:now,actor_id:"vendor",secret:"must-never-expose"})));
    const first=await adminActivity(admin,{kind:"queue",page:1}),second=await adminActivity(admin,{kind:"queue",page:2});assert.equal(first.total,35);assert.equal(first.rows.length,30);assert.equal(second.rows.length,5);assert.equal(first.rows.some(a=>second.rows.some(b=>a.id===b.id)),false);
    assert.equal((await adminActivity(admin,{kind:"queue",q:"QA-34"})).total,1);assert.equal((await adminActivity(admin,{q:".*"})).total,0);
    assert.equal(JSON.stringify(first).includes("must-never-expose"),false);await assert.rejects(adminActivity(admin,{from:"2026-10-28",to:"2026-10-27"}),status(400));
    assert.ok((await adminActivity(admin,{kind:"bookings"})).rows.some(r=>r.target==="retained-booking"));
  });
});
