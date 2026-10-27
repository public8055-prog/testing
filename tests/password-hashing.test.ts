import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash,randomBytes,scrypt } from "node:crypto";
import { Collection,type Document,type Filter,type FindOneAndUpdateOptions,type UpdateFilter,type WithId } from "mongodb";
import { HttpError } from "../lib/http";
import { hashPassword,checkPassword,passwordNeedsUpgrade,createPasswordWorkLimiter,PASSWORD_HASH_POLICY,PASSWORD_WORK_LIMITS,DUMMY_PASSWORD_HASH } from "../lib/password-hashing";
import { mongoFixture } from "./helpers/mongo-fixture";

const rejectedStatus=(status:number)=>(error:unknown)=>error instanceof HttpError&&error.status===status;
type ForwardFindOneAndUpdate=(this:Collection<Document>,filter:Filter<Document>,update:UpdateFilter<Document>,options:FindOneAndUpdateOptions)=>Promise<WithId<Document>|null>;
async function legacyHash(password:string){const salt=randomBytes(16).toString("hex");const hash=await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:32*1024*1024},(error,key)=>error?reject(error):resolve(key)));return `${salt}:${hash.toString("hex")}`;}

test("Argon2id hashes preserve exact input, use bounded strong costs and verify legacy scrypt",async()=>{
  assert.deepEqual(PASSWORD_HASH_POLICY,{algorithm:"argon2id",version:19,memoryCost:65536,timeCost:3,parallelism:1,hashLength:32,saltBytes:16});
  assert.deepEqual(PASSWORD_WORK_LIMITS,{concurrency:2,maxQueued:8,waitMs:3000});
  const password="  सावधान 🔐 password\0end  ";
  const first=await hashPassword(password),second=await hashPassword(password);
  const current=/^\$argon2id\$v=19\$m=65536,(?:t=3,p=1|p=1,t=3)\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;
  assert.match(first,current);assert.match(DUMMY_PASSWORD_HASH,current,"Unknown identifiers use the same current work factor");
  assert.notEqual(first,second,"Each hash has an independent random salt");
  assert.equal(await checkPassword(password,first),true);assert.equal(await checkPassword(password.trim(),first),false);
  assert.equal(await checkPassword("wrong password",first),false);assert.equal(passwordNeedsUpgrade(first),false);
  const old=await legacyHash(password);assert.equal(passwordNeedsUpgrade(old),true);assert.equal(await checkPassword(password,old),true);assert.equal(await checkPassword("wrong password",old),false);
  const salt=randomBytes(16).toString("hex"),strongLegacy=await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:192*1024*1024},(error,key)=>error?reject(error):resolve(key)));
  const versioned=`$scrypt$v=1$N=131072,r=8,p=1$${salt}$${strongLegacy.toString("hex")}`;assert.equal(passwordNeedsUpgrade(versioned),true);assert.equal(await checkPassword(password,versioned),true);
  for(const malformed of ["",first.replace("v=19","v=2"),first.replace("m=65536","m=2147483648"),first+"$extra","short:00",`${"0".repeat(32)}:not-hex`])assert.equal(await checkPassword(password,malformed),false);
  await assert.rejects(()=>hashPassword("x".repeat(129)),rejectedStatus(400));
});

test("password work limit bounds active jobs, queue depth, timeout and failure recovery",async()=>{
  const limit=createPasswordWorkLimiter({concurrency:2,maxQueued:2,waitMs:500});
  let release!:()=>void,active=0,maximum=0,started=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const jobs=Array.from({length:4},(_,i)=>limit(async()=>{active++;started++;maximum=Math.max(maximum,active);await gate;active--;return i;}));
  await assert.rejects(()=>limit(async()=>99),rejectedStatus(503));
  assert.equal(started,2);release();assert.deepEqual(await Promise.all(jobs),[0,1,2,3]);assert.equal(maximum,2);
  const short=createPasswordWorkLimiter({concurrency:1,maxQueued:1,waitMs:15});
  let unblock!:()=>void,expiredJobRan=false;
  const running=short(()=>new Promise<void>(resolve=>{unblock=resolve;}));
  await assert.rejects(()=>short(async()=>{expiredJobRan=true;}),rejectedStatus(503));
  unblock();await running;assert.equal(expiredJobRan,false,"Timed-out work must never allocate hashing memory later");
  await assert.rejects(()=>short(async()=>{throw new Error("Injected worker failure");}),/Injected worker failure/);
  assert.equal(await short(async()=>"recovered"),"recovered");
});

test("successful legacy authentication upgrades safely without overwriting a concurrent password reset",async t=>{
  const fixture=await mongoFixture("hashupgrade");process.env.REDIS_URL="redis://127.0.0.1:6380";process.env.AUTH_JWT_SECRET=randomBytes(32).toString("base64");t.after(()=>fixture.close());
  const {authenticateUser,createSession}=await import("../lib/auth");
  const {resetPassword}=await import("../lib/password-reset");
  const userId="legacy-upgrade",password=" Legacy exact passphrase 🔐 ",old=await legacyHash(password);
  await fixture.seedUser(userId,"legacy-upgrade@example.test");await fixture.users.updateOne({id:userId},{$set:{password_hash:old}});
  await assert.rejects(()=>authenticateUser("legacy-upgrade@example.test","wrong password"),rejectedStatus(401));
  assert.equal((await fixture.users.findOne({id:userId}))?.password_hash,old,"Failed logins do not upgrade or change the password");
  assert.equal((await authenticateUser("legacy-upgrade@example.test",password)).id,userId);
  const upgraded=String((await fixture.users.findOne({id:userId}))!.password_hash);assert.equal(passwordNeedsUpgrade(upgraded),false);assert.equal(await checkPassword(password,upgraded),true);
  await authenticateUser("legacy-upgrade@example.test",password);assert.equal((await fixture.users.findOne({id:userId}))?.password_hash,upgraded,"Current hashes are not needlessly replaced");

  await t.test("a competing successful upgrade is reused only after verifying its password",async sub=>{
    await fixture.users.updateOne({id:userId},{$set:{password_hash:old}});
    const original:ForwardFindOneAndUpdate=Collection.prototype.findOneAndUpdate;let raced=false;
    const patch=sub.mock.method(Collection.prototype,"findOneAndUpdate",async function(this:Collection<Document>,filter:Filter<Document>,update:UpdateFilter<Document>,options:FindOneAndUpdateOptions={}){
      if(!raced&&this.collectionName==="users"&&filter.id===userId&&filter.password_hash===old){raced=true;await fixture.users.updateOne({id:userId},{$set:{password_hash:upgraded}});}
      return original.call(this,filter,update,options);
    });
    try{assert.equal((await authenticateUser("legacy-upgrade@example.test",password)).id,userId);assert.equal(raced,true);assert.equal((await fixture.users.findOne({id:userId}))?.password_hash,upgraded);}
    finally{patch.mock.restore();}
  });

  await t.test("a real reset between hash calculation and compare-and-set cannot be overwritten",async sub=>{
    await fixture.users.updateOne({id:userId},{$set:{password_hash:old}});
    const token=randomBytes(32).toString("hex"),tokenHash=createHash("sha256").update(token).digest("hex"),newPassword="Reset passphrase must win",now=new Date().toISOString();
    await fixture.db.collection<{_id:string;token_hash:string;user_id:string;expires_at:string;used_at:null;created_at:string}>("password_reset_tokens").insertOne({_id:tokenHash,token_hash:tokenHash,user_id:userId,expires_at:new Date(Date.now()+60000).toISOString(),used_at:null,created_at:now});
    await fixture.db.collection<{_id:string;token_hash:string;user_id:string;expires_at:string}>("sessions").insertOne({_id:"prior-session",token_hash:"prior-session",user_id:userId,expires_at:new Date(Date.now()+60000).toISOString()});
    const original:ForwardFindOneAndUpdate=Collection.prototype.findOneAndUpdate;let raced=false;
    const patch=sub.mock.method(Collection.prototype,"findOneAndUpdate",async function(this:Collection<Document>,filter:Filter<Document>,update:UpdateFilter<Document>,options:FindOneAndUpdateOptions={}){
      if(!raced&&this.collectionName==="users"&&filter.id===userId&&filter.password_hash===old){raced=true;await resetPassword(token,newPassword);}
      return original.call(this,filter,update,options);
    });
    try{await assert.rejects(()=>authenticateUser("legacy-upgrade@example.test",password),rejectedStatus(401));assert.equal(raced,true);}
    finally{patch.mock.restore();}
    const current=String((await fixture.users.findOne({id:userId}))!.password_hash);
    assert.equal(await checkPassword(newPassword,current),true);assert.equal(await checkPassword(password,current),false);
    await assert.rejects(()=>createSession(userId,old),rejectedStatus(401));
    assert.equal(await fixture.db.collection("sessions").countDocuments({user_id:userId}),0);
  });
});
