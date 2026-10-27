import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Collection, type Document, type Filter, type FindOptions, type UpdateOptions, type UpdateFilter } from "mongodb";
import { mongoFixture } from "./helpers/mongo-fixture";
import { HttpError } from "../lib/http";
import { addServiceFollowup, acknowledgeNotification, ensureOperations, issueServiceToken, listNotifications, listTrackedServices, publishServiceUpdate, recordCashReceipt, sendCustomerNotification, updateTrackedStatus } from "../lib/service-operations";
import { getRedis } from "../lib/redis";
import { closeUpdatesHub, subscribeToUpdates } from "../lib/updates-hub";
import { adminMutation } from "../lib/platform";
import { mongoCollection } from "../lib/mongo";

const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;

test("service operations enforce persisted roles, token ownership, immutable updates, safe cash receipts and status timing", async t => {
  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6380";
  const fixture = await mongoFixture("operations");
  process.env.REDIS_URL = redisUrl;
  const prefix = `${fixture.db.databaseName}:operations-test`;
  process.env.REDIS_KEY_PREFIX = prefix;
  t.after(async () => {
    try { const redis = await getRedis(); for await (const keys of redis.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) { assert.ok(keys.every(key => key.startsWith(`${prefix}:`))); if (keys.length) await redis.del(keys); } }
    finally { await closeUpdatesHub(); await fixture.close(); }
  });
  const { db } = fixture;
  for (const id of ["customer-a", "customer-b", "admin-a", "admin-b"]) await fixture.seedUser(id);
  await fixture.users.updateMany({ id: { $in: ["admin-a", "admin-b"] } }, { $set: { role: "admin" } });
  const customer = { id: "customer-a", role: "customer" }, outsider = { id: "customer-b", role: "customer" }, admin = { id: "admin-a", role: "admin" }, otherAdmin = { id: "admin-b", role: "admin" };
  await ensureOperations();
  const now = new Date().toISOString();
  await fixture.seedBooking("cash-service", customer.id, { payment: "cash", status: "in_progress", total: 500, subtotal: 500, date: "2020-01-01", items: JSON.stringify([{ slug: "cleaning", title: "Home cleaning", price: 500, qty: 1, durationMin: 90 }]) });
  const token = await issueServiceToken("catalog", "cash-service", customer.id, now);
  await fixture.seedBooking("other-service", outsider.id, { payment: "cash", status: "confirmed" });
  const otherToken = await issueServiceToken("catalog", "other-service", outsider.id, now);

  await t.test("service tokens are stable and customer queries cannot cross ownership", async () => {
    assert.equal((await issueServiceToken("catalog", "cash-service", customer.id, now)).token, token.token);
    assert.match(token.token, /^UK-\d{6}-[A-F0-9]{12}$/);
    assert.equal((await listTrackedServices(customer)).services.length, 1);
    assert.equal((await listTrackedServices(outsider, { token: token.token })).services.length, 0);
    assert.equal((await listTrackedServices(customer, { token: otherToken.token })).total, 0);
    await assert.rejects(() => listTrackedServices(customer, { admin: true }), status(403));
    await assert.rejects(() => listTrackedServices({ id: customer.id, role: "admin" }, { admin: true }), status(403));
    assert.equal((await listTrackedServices(admin, { admin: true })).services.length, 2);
    assert.equal((await listTrackedServices(admin)).services.length, 0);
  });

  await t.test("follow-ups append immutable rows and stale concurrent versions fail", async () => {
    const followup = { token: token.token, version: 0, message: "Your professional will call before arriving.", notify: true };
    await assert.rejects(() => addServiceFollowup(customer, followup), status(403));
    await assert.rejects(() => addServiceFollowup({ id: customer.id, role: "admin" }, followup), status(403));
    const race = await Promise.allSettled([addServiceFollowup(admin, followup), addServiceFollowup(otherAdmin, { ...followup, message: "Your appointment details have been reviewed." })]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(race.filter(result => result.status === "rejected").every(result => result.status === "rejected" && status(409)(result.reason)));
    const original = await db.collection("service_followups").findOne({ token: token.token });
    assert.ok(original);
    await addServiceFollowup(admin, { ...followup, version: 1, message: "A second update is available for your service.", notify: false });
    assert.deepEqual(await db.collection("service_followups").findOne({ _id: original._id }), original);
    assert.equal(await db.collection("service_followups").countDocuments({ token: token.token }), 2);
    assert.equal((await listTrackedServices(customer)).services[0].version, 2);
    assert.equal((await listNotifications(customer.id)).notifications.length, 1);
    assert.equal((await listNotifications(outsider.id)).notifications.length, 0);
    await assert.rejects(() => addServiceFollowup(admin, { ...followup, version: 2, nextFollowupAt: "2020-01-01T00:00:00.000Z" }), status(400));
  });

  await t.test("targeted notifications bind replays to their content and keep read/dismiss private", async () => {
    const notification = { customerId: customer.id, title: "Appointment update", message: "Your professional has confirmed the requested details.", token: token.token, requestKey: randomUUID() };
    await assert.rejects(() => sendCustomerNotification(customer, notification), status(403));
    await assert.rejects(() => sendCustomerNotification({ id: customer.id, role: "admin" }, notification), status(403));
    await assert.rejects(() => sendCustomerNotification(admin, { ...notification, token: otherToken.token }), status(404));
    const replay = await Promise.allSettled([sendCustomerNotification(admin, notification), sendCustomerNotification(admin, notification)]);
    assert.ok(replay.every(result => result.status === "fulfilled"), `Identical concurrent notification requests must be replay-safe: ${replay.map(result => result.status === "rejected" ? String(result.reason) : "ok").join(", ")}`);
    await sendCustomerNotification(admin, notification);
    assert.equal(await db.collection("customer_notifications").countDocuments({ title: notification.title }), 1);
    await assert.rejects(() => sendCustomerNotification(admin, { ...notification, message: "This is a different message using the same request key." }), status(409));
    await assert.rejects(() => sendCustomerNotification(admin, { ...notification, customerId: outsider.id, token: otherToken.token }), status(409));
    const inbox = await listNotifications(customer.id), item = inbox.notifications.find(row => row.title === notification.title)!;
    assert.ok(item); assert.equal(inbox.unread, 2);
    assert.equal((await listNotifications(outsider.id)).notifications.length, 0);
    await assert.rejects(() => acknowledgeNotification(outsider.id, item.id, "read"), status(404));
    await assert.rejects(() => acknowledgeNotification(outsider.id, item.id, "dismiss"), status(404));
    await acknowledgeNotification(customer.id, item.id, "dismiss");
    let own = (await listNotifications(customer.id)).notifications.find(row => row.id === item.id)!;
    assert.ok(own.popup_dismissed_at); assert.equal(own.read_at, null);
    await acknowledgeNotification(customer.id, item.id, "read");
    own = (await listNotifications(customer.id)).notifications.find(row => row.id === item.id)!;
    assert.ok(own.read_at); assert.ok(own.popup_dismissed_at);
    assert.equal((await listNotifications(customer.id)).unread, 1);
  });

  await t.test("completion never invents payment and exact cash can only be recorded once", async () => {
    await assert.rejects(() => updateTrackedStatus(customer, token.token, "completed"), status(403));
    await updateTrackedStatus(admin, token.token, "completed");
    assert.equal((await fixture.bookings.findOne({ id: "cash-service" }))?.payment_status, "unpaid");
    assert.equal(await db.collection("cash_receipts").countDocuments(), 0);
    await assert.rejects(() => recordCashReceipt(customer, token.token, "RCPT-001", 500), status(403));
    await assert.rejects(() => recordCashReceipt(admin, token.token, "RCPT-001", 499), status(409));
    await assert.rejects(() => recordCashReceipt(admin, otherToken.token, "RCPT-002", 100), status(409));
    const receipts = await Promise.allSettled([recordCashReceipt(admin, token.token, "RCPT-001", 500), recordCashReceipt(otherAdmin, token.token, "RCPT-002", 500)]);
    assert.equal(receipts.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(receipts.filter(result=>result.status==="rejected").every(result=>result.status==="rejected"&&status(409)(result.reason)),"Concurrent duplicate cash receipts return a business conflict");
    assert.equal(await db.collection("cash_receipts").countDocuments({ booking_id: "cash-service" }), 1);
    assert.equal((await fixture.bookings.findOne({ id: "cash-service" }))?.payment_status, "paid");
    assert.equal(await db.collection("booking_events").countDocuments({ booking_id: "cash-service", type: "cash.collected" }), 1);
    await assert.rejects(() => recordCashReceipt(admin, token.token, "RCPT-003", 500), status(409));
    await assert.rejects(() => updateTrackedStatus(admin, token.token, "confirmed"), status(409));
  });

  await t.test("catalog and provider status progression respects schedule and payment state", async () => {
    await fixture.seedBooking("future-catalog", customer.id, { payment: "cash", status: "in_progress", date: "2099-01-01", items: JSON.stringify([{ title: "Long service", slug: "long", qty: 2, durationMin: 120, price: 50 }]) });
    const futureCatalog = await issueServiceToken("catalog", "future-catalog", customer.id, now);
    await assert.rejects(() => updateTrackedStatus(admin, futureCatalog.token, "completed"), status(409));
    await fixture.seedBooking("online-unpaid", customer.id, { payment: "card", status: "confirmed", date: "2020-01-01" });
    const online = await issueServiceToken("catalog", "online-unpaid", customer.id, now);
    await assert.rejects(() => updateTrackedStatus(admin, online.token, "in_progress"), status(409));
    const providerBookings = db.collection<{ _id: string; id: string; customer_id: string; provider_id: string; kind: string; starts_at: string; ends_at: string; status: string; payment_status: string; total: number; created_at: string }>("marketplace_bookings");
    await db.collection<{ _id: string; id: string; display_name: string }>("marketplace_providers").insertOne({ _id: "provider", id: "provider", display_name: "QA Professional" });
    await providerBookings.insertMany([
      { _id: "provider-past", id: "provider-past", customer_id: customer.id, provider_id: "provider", kind: "hourly", starts_at: "2020-01-01T01:00:00.000Z", ends_at: "2020-01-01T02:00:00.000Z", status: "pending", payment_status: "pending", total: 250, created_at: now },
      { _id: "provider-future", id: "provider-future", customer_id: customer.id, provider_id: "provider", kind: "hourly", starts_at: "2099-01-01T01:00:00.000Z", ends_at: "2099-01-01T02:00:00.000Z", status: "confirmed", payment_status: "pending", total: 250, created_at: now },
    ]);
    const past = await issueServiceToken("provider", "provider-past", customer.id, now), future = await issueServiceToken("provider", "provider-future", customer.id, now);
    await assert.rejects(() => updateTrackedStatus(admin, past.token, "completed"), status(409));
    await assert.rejects(() => updateTrackedStatus(admin, future.token, "in_progress"), status(409));
    await updateTrackedStatus(admin, past.token, "confirmed");
    await updateTrackedStatus(admin, past.token, "in_progress");
    await updateTrackedStatus(admin, past.token, "completed");
    const final = await providerBookings.findOne({ id: "provider-past" });
    assert.equal(final?.status, "completed"); assert.equal(final?.payment_status, "pending");
    await assert.rejects(() => updateTrackedStatus(admin, past.token, "cancelled"), status(409));
    await assert.rejects(() => recordCashReceipt(admin, past.token, "RCPT-004", 250), status(400));
    await assert.rejects(() => updateTrackedStatus(admin, past.token, "invented"), status(400));
  });

  await t.test("the shared Redis update subscriber targets the right account and removes listeners", async () => {
    const counts = { first: 0, second: 0, other: 0 };
    const waitFor = async (predicate: () => boolean) => { for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await delay(50); assert.ok(predicate(), "The targeted Redis update did not arrive"); };
    const [first, second, other] = await Promise.all([
      subscribeToUpdates(customer.id, () => { counts.first++; }),
      subscribeToUpdates(customer.id, () => { counts.second++; }),
      subscribeToUpdates(outsider.id, () => { counts.other++; }),
    ]);
    try {
      await publishServiceUpdate(customer.id);
      await waitFor(() => counts.first === 1 && counts.second === 1);
      assert.equal(counts.other, 0);
      await first();
      await publishServiceUpdate(customer.id);
      await waitFor(() => counts.second === 2);
      assert.equal(counts.first, 1);
      await second();
      await publishServiceUpdate(customer.id);
      await publishServiceUpdate(outsider.id);
      await waitFor(() => counts.other === 1);
      assert.deepEqual(counts, { first: 1, second: 2, other: 1 });
    } finally { await first(); await second(); await other(); }
  });
});

test("operations recheck revoked administrators and commit status notifications atomically",async t=>{
  const fixture=await mongoFixture("opsauth");
  process.env.REDIS_URL="redis://127.0.0.1:6380";
  t.after(()=>fixture.close());
  const admin={id:"racing-admin",role:"admin"},supervisor={id:"active-admin",role:"admin"},customer="operation-customer";
  for(const id of [admin.id,supervisor.id,customer])await fixture.seedUser(id);
  await fixture.users.updateMany({id:{$in:[admin.id,supervisor.id]}},{$set:{role:"admin"}});
  await ensureOperations();
  const now=new Date().toISOString();
  await fixture.seedBooking("guarded-cash",customer,{payment:"cash",status:"in_progress",date:"2020-01-01"});
  await fixture.seedBooking("guarded-catalog",customer,{payment:"cash",status:"confirmed",date:"2020-01-01"});
  const cash=await issueServiceToken("catalog","guarded-cash",customer,now),catalog=await issueServiceToken("catalog","guarded-catalog",customer,now);
  const providerBookings=await mongoCollection("marketplace_bookings");
  await providerBookings.insertOne({_id:"guarded-provider",id:"guarded-provider",customer_id:customer,provider_id:"guarded-professional",status:"confirmed",payment_status:"pending",starts_at:"2020-01-01T01:00:00.000Z",ends_at:"2020-01-01T02:00:00.000Z",total:100,created_at:now});
  const provider=await issueServiceToken("provider","guarded-provider",customer,now);
  const operations:[string,()=>Promise<unknown>][]=[
    ["notification",()=>sendCustomerNotification(admin,{customerId:customer,title:"Race protected update",message:"This update must not survive administrator revocation.",requestKey:randomUUID()})],
    ["follow-up",()=>addServiceFollowup(admin,{token:catalog.token,version:0,message:"This follow-up must not survive administrator revocation.",notify:true})],
    ["cash receipt",()=>recordCashReceipt(admin,cash.token,"GUARDED-RECEIPT",100)],
    ["catalog status",()=>updateTrackedStatus(admin,catalog.token,"in_progress")],
    ["provider status",()=>updateTrackedStatus(admin,provider.token,"in_progress")],
  ];
  for(const revocation of ["deactivation","role change"] as const)for(const [name,operation]of operations){
    await t.test(`${name} rejects ${revocation} after its preflight read`,async sub=>{
      const original=Collection.prototype.findOne;
      let triggered=false;
      // Force the exact TOCTOU window using real Mongo writes: finish the stale preflight
      // read, commit revocation, and only then let the operation enter its transaction.
      const patched=sub.mock.method(Collection.prototype,"findOne",async function(this:Collection<Document>,filter:Filter<Document>={},options:FindOptions={}){
        const result=await original.call(this,filter,options);
        if(!triggered&&this.collectionName==="platform_account_status"&&filter.user_id===admin.id&&!options.session){
          triggered=true;
          if(revocation==="deactivation")await adminMutation(supervisor,{action:"account",id:admin.id,active:false});
          else await fixture.users.updateOne({id:admin.id},{$set:{role:"customer"}});
        }
        return result;
      });
      try{await assert.rejects(operation,status(403));assert.equal(triggered,true,"Revocation occurred between preflight and transaction");}
      finally{patched.mock.restore();await fixture.users.updateOne({id:admin.id},{$set:{role:"admin"}});await fixture.db.collection("platform_account_status").deleteOne({user_id:admin.id});}
      assert.equal(await fixture.db.collection("customer_notifications").countDocuments(),0);
      assert.equal(await fixture.db.collection("service_followups").countDocuments(),0);
      assert.equal(await fixture.db.collection("cash_receipts").countDocuments(),0);
      assert.equal((await fixture.bookings.findOne({id:"guarded-cash"}))?.payment_status,"unpaid");
      assert.equal((await fixture.bookings.findOne({id:"guarded-catalog"}))?.status,"confirmed");
      assert.equal((await providerBookings.findOne({id:"guarded-provider"}))?.status,"confirmed");
    });
  }
  for(const [source,token,id]of [["catalog",catalog,"guarded-catalog"],["provider",provider,"guarded-provider"]]as const){
    await t.test(`${source} status rolls back if durable notification persistence fails`,async sub=>{
      const original=Collection.prototype.updateOne;
      const patched=sub.mock.method(Collection.prototype,"updateOne",async function(this:Collection<Document>,filter:Filter<Document>,update:UpdateFilter<Document>,options:UpdateOptions={}){
        if(this.collectionName==="customer_notifications"&&options.session)throw new Error("Injected notification persistence failure");
        return original.call(this,filter,update,options);
      });
      try{await assert.rejects(()=>updateTrackedStatus(admin,token.token,"in_progress"),/Injected notification persistence failure/);}
      finally{patched.mock.restore();}
      const bookings=source==="catalog"?fixture.bookings:providerBookings;
      assert.equal((await bookings.findOne({id}))?.status,"confirmed");
      const events=fixture.db.collection(source==="catalog"?"booking_events":"marketplace_events");
      assert.equal(await events.countDocuments({booking_id:id}),0,"Status audit rolls back with its update");
      assert.equal(await fixture.db.collection("customer_notifications").countDocuments({token:token.token}),0);
      await Promise.all([updateTrackedStatus(admin,token.token,"in_progress"),updateTrackedStatus(supervisor,token.token,"in_progress")]);
      assert.equal((await bookings.findOne({id}))?.status,"in_progress");
      assert.equal(await events.countDocuments({booking_id:id}),1);
      assert.equal(await fixture.db.collection("customer_notifications").countDocuments({token:token.token}),1,"Concurrent repeats commit one notification");
    });
  }
});
