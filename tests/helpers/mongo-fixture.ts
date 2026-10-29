import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { initDb, closeDb } from "../../lib/db";
import { getMongoDb, mongoCollection } from "../../lib/mongo";
import { getRedis,closeRedis } from "../../lib/redis";
import { syncAuthoredCatalog } from "../../scripts/sync-catalog";

/** Tests use only a generated database; existing application records are never dropped. */
export async function mongoFixture(label:string,options:{catalog?:boolean}={}){
  process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true";
  // Atlas Free limits names to 38 bytes; keep a random, identifiable test scope.
  const name=`urbankare_test_${label.replace(/[^a-z0-9]/gi,"").slice(0,3)}_${randomUUID().replaceAll("-","").slice(0,18)}`;
  const prefix=`urbankare:${name}`;
  process.env.MONGODB_DB=name;process.env.REDIS_KEY_PREFIX=prefix;process.env.REDIS_URL||="redis://127.0.0.1:6380";
  try{await initDb();if(options.catalog)await syncAuthoredCatalog();}catch(error){await closeDb();throw error;}
  const db=await getMongoDb();
  const users=await mongoCollection("users"),bookings=await mongoCollection("bookings"),refunds=await mongoCollection("payment_refunds"),paymentEvents=await mongoCollection("payment_events");
  return {db,users,bookings,refunds,paymentEvents,
    async seedUser(id:string,email=`${id}@example.test`){await users.insertOne({_id:id,id,email,name:"QA Test",password_hash:"unused-test-fixture",role:"customer",created_at:new Date().toISOString()});},
    async seedBooking(id:string,userId:string,overrides:Record<string,unknown>={}){
      const now=new Date().toISOString();await bookings.insertOne({_id:id,id,user_id:userId,items:"[]",total:100,subtotal:100,discount:0,visit_fee:0,name:"QA Test",phone:"9876543210",address:"QA Test address",date:"2030-12-01",slot:"09:00 AM",payment:"card",status:"pending",payment_status:"unpaid",razorpay_order_id:null,razorpay_payment_id:null,payment_provider:null,stripe_session_id:null,stripe_payment_intent_id:null,created_at:now,updated_at:now,...overrides});
    },
    async close(){
      assert.equal(db.databaseName,name);assert.ok(name.startsWith("urbankare_test_"));
      try{
        const redis=await getRedis();for await(const keys of redis.scanIterator({MATCH:`${prefix}:*`,COUNT:100})){assert.ok(keys.every(key=>key.startsWith(`${prefix}:`)));if(keys.length)await redis.del(keys);}
      }finally{
        try{
          await closeRedis();
          try{await db.dropDatabase();}catch(error){
            // Atlas integration credentials may allow collection cleanup while
            // withholding dropDatabase. Do not widen production permissions for QA.
            if(!error||typeof error!=="object"||!("code"in error)||![13,8000].includes(Number(error.code))||!("message"in error)||!/dropDatabase/.test(String(error.message)))throw error;
            for(const collection of await db.listCollections({},{nameOnly:true}).toArray())await db.collection(collection.name).drop();
          }
        }finally{await closeDb();}
      }
    },
  };
}
