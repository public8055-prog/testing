import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomBytes,randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { mongoFixture } from "./helpers/mongo-fixture";

test("MongoDB recovery tokens are hashed, expire, can be consumed only once and revoke sessions",async()=>{
 const fixture=await mongoFixture("reset");process.env.REDIS_URL="redis://127.0.0.1:6380";process.env.AUTH_JWT_SECRET=randomBytes(32).toString("base64");
 const {requestPasswordReset,resetPassword,passwordResetConfigured}=await import("../lib/password-reset");const {checkPassword,registerUser,createSession}=await import("../lib/auth");
 const db=fixture.db,c=(name:string)=>db.collection<Document&{_id:string}>(name),email=`${randomUUID()}@example.test`;
 const originalFetch=globalThis.fetch;let delivered="";
 try{
  delete process.env.EMAIL_DELIVERY_URL;delete process.env.EMAIL_DELIVERY_TOKEN;assert.equal(passwordResetConfigured(),false);await assert.rejects(()=>requestPasswordReset(email),/not configured/);
  process.env.EMAIL_DELIVERY_URL="https://mail-adapter.example.test/send";process.env.EMAIL_DELIVERY_TOKEN="test-adapter-credential";process.env.APP_URL="http://localhost:3000";assert.equal(passwordResetConfigured(),true);
  globalThis.fetch=async(_url,init)=>{delivered=JSON.parse(String(init?.body)).text;return new Response("{}",{status:200});};
  const{id}=await registerUser("QA recovery",email,`QA-${randomUUID()}!`);const previousHash=String((await c("users").findOne({id}))!.password_hash);await c("sessions").insertOne({_id:randomUUID(),token_hash:randomUUID(),user_id:id,expires_at:new Date(Date.now()+60000).toISOString()});
  await requestPasswordReset(email);const token=delivered.match(/token=([a-f0-9]{64})/)?.[1];assert.ok(token);
  const records=await c("password_reset_tokens").find({user_id:id}).toArray();assert.equal(records.length,1);assert.notEqual(records[0].token_hash,token);
  const attempts=await Promise.allSettled([resetPassword(token,"new secure passphrase"),resetPassword(token,"another secure passphrase")]);assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);assert.equal(await c("sessions").countDocuments({user_id:id}),0);
  const user=await c("users").findOne({id});assert.ok(await checkPassword("new secure passphrase",user!.password_hash)||await checkPassword("another secure passphrase",user!.password_hash));
  await assert.rejects(()=>createSession(id,previousHash),/unavailable/);assert.equal(await c("sessions").countDocuments({user_id:id}),0);
  await assert.rejects(()=>resetPassword(token,"reused secure passphrase"),/expired or was already used/);delivered="";await requestPasswordReset("does-not-exist@example.test");assert.equal(delivered,"");
  await requestPasswordReset(email);const expiring=delivered.match(/token=([a-f0-9]{64})/)?.[1];assert.ok(expiring);await c("password_reset_tokens").updateMany({user_id:id},{$set:{expires_at:"2000-01-01T00:00:00.000Z"}});await assert.rejects(()=>resetPassword(expiring,"another secure password"),/expired/);
 }finally{globalThis.fetch=originalFetch;await fixture.close();}
});
