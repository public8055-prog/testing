import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Document } from "mongodb";
import { mongoFixture } from "./helpers/mongo-fixture";
import { seedTestCategory } from "./helpers/catalog-fixture";

test("administration enforces persisted roles, keeps history, validates private documents and reports only actual payments", async () => {
  const fixture = await mongoFixture("adminmodules"); process.env.REDIS_URL = "redis://127.0.0.1:6380";
  const { ensurePlatform, adminMutation, adminData, getActiveBanners } = await import("../lib/platform");
  const { adminManagementMutation, listAdminUsers, adminUserDetails, submitProviderDocument, listProviderDocuments } = await import("../lib/admin-management");
  const { adminReport, ledgerCsv, operationsCsv, paymentReceipt, adminRequestRefund, reportRange } = await import("../lib/admin-reports");
  const { reportPdf, receiptPdf } = await import("../lib/admin-pdf");
  const { storeUpload } = await import("../lib/uploads");
  const db = fixture.db, c = (name: string) => db.collection<Document & { _id: string }>(name), now = new Date().toISOString();
  const superId = randomUUID(), otherSuper = randomUUID(), adminId = randomUUID(), customer = randomUUID(), providerUser = randomUUID(), provider = randomUUID();
  const root = { id: superId, role: "SUPER_ADMIN" }, admin = { id: adminId, role: "ADMIN" };
  try {
    await ensurePlatform();
    await seedTestCategory(db);
    for (const [id, role] of [[superId, "SUPER_ADMIN"], [otherSuper, "SUPER_ADMIN"], [adminId, "ADMIN"], [customer, "CUSTOMER"], [providerUser, "PROVIDER"]]) await c("users").insertOne({ _id: id, id, name: "QA " + role, email: `${id}@example.test`, role, password_hash: "private-never-return", created_at: now });
    await c("marketplace_providers").insertOne({ _id: provider, id: provider, user_id: providerUser, display_name: "QA Provider", category: "Cleaning", active: 0, verified: 0, created_at: now });
    await assert.rejects(() => adminData({ id: customer, role: "SUPER_ADMIN" }), /Administrator access/);
    await assert.rejects(() => listAdminUsers({ id: customer, role: "ADMIN" }, {}), /Administrator access/);
    await assert.rejects(() => adminManagementMutation(admin, { action: "account-role", id: customer, role: "ADMIN", reason: "Requested administrator access" }), /super administrator/);
    await assert.rejects(() => adminManagementMutation(root, { action: "account-delete", id: superId, reason: "Delete my own administrator" }), /own/);
    await c("sessions").insertOne({ _id: randomUUID(), user_id: customer, token_hash: randomUUID(), expires_at: new Date(Date.now() + 60000).toISOString() });
    await adminManagementMutation(root, { action: "account-role", id: customer, role: "PROVIDER", reason: "Approved provider role change" });
    assert.equal(await c("sessions").countDocuments({ user_id: customer }), 0);
    assert.equal((await c("users").findOne({ id: customer }))!.role, "PROVIDER");
    await adminManagementMutation(admin, { action: "account", id: customer, active: false, reason: "Temporarily blocked for review" });
    assert.equal((await listAdminUsers(admin, { status: "blocked" })).rows.some(u => u.id === customer), true);
    await adminManagementMutation(admin, { action: "account", id: customer, active: true, reason: "Account review completed" });
    const booking = randomUUID(); await fixture.seedBooking(booking, customer, { status: "completed", payment_status: "paid", payment: "cash", total: 321, name: "=Formula customer", created_at: now });
    await adminManagementMutation(admin, { action: "account-delete", id: customer, reason: "Customer requested account closure" });
    assert.equal((await c("bookings").findOne({ id: booking }))!.total, 321);
    assert.equal((await listAdminUsers(admin, { status: "deleted" })).rows.some(u => u.id === customer), true);
    assert.equal(JSON.stringify(await adminUserDetails(admin, customer)).includes("private-never-return"), false);
    await assert.rejects(() => adminManagementMutation(root, { action: "account", id: customer, active: true, reason: "Cannot revive deleted account" }), /deleted/);
    const literalSearch = await listAdminUsers(admin, { q: ".*" }); assert.equal(literalSearch.total, 0, "Search input is escaped rather than interpreted as a regular expression.");
    for (let i = 0; i < 25; i++) { const id = randomUUID(); await c("users").insertOne({ _id: id, id, name: "Paged fixture " + i, email: `${id}@example.test`, role: "CUSTOMER", created_at: now }); }
    const page1 = await listAdminUsers(admin, { q: "Paged fixture", page: 1 }), page2 = await listAdminUsers(admin, { q: "Paged fixture", page: 2 }); assert.equal(page1.total, 25); assert.equal(page1.rows.length, 20); assert.equal(page2.rows.length, 5); assert.equal(page1.rows.some(a => page2.rows.some(b => a.id === b.id)), false);

    const {default:sharp}=await import("sharp");
    const pdf = await sharp({create:{width:100,height:100,channels:3,background:"#386477"}}).png().toBuffer();
    const identity={identityKind:"masked_aadhaar",consent:true,redacted:true};
    const foreign = await storeUpload({ ownerUserId: adminId, purpose: "provider-document", documentType: "identity", originalName: "qa-other.pdf", bytes: pdf });
    await assert.rejects(() => submitProviderDocument(providerUser, { uploadId: foreign.id }), /does not belong/);
    const upload = await storeUpload({ ownerUserId: providerUser, purpose: "provider-document", documentType: "identity", originalName: "qa-identity.pdf", bytes: pdf });
    await submitProviderDocument(providerUser, { uploadId: upload.id, ...identity });
    await assert.rejects(() => submitProviderDocument(providerUser, { uploadId: upload.id, ...identity }), /already been submitted/);
    await assert.rejects(() => adminManagementMutation(admin, { action: "provider-status", id: provider, status: "approved", reason: "Cannot approve unreviewed documents" }), /identity document/);
    await assert.rejects(() => adminMutation(admin, { action: "provider", id: provider, active: true }), /identity document/);
    const documents = await listProviderDocuments(providerUser); assert.equal(documents.documents.length, 1); assert.equal(documents.documents[0].status, "pending");
    await adminManagementMutation(admin, { action: "provider-document-review", id: documents.documents[0].id, status: "approved", identityChecked: true, reason: "Identity evidence reviewed and approved" });
    await adminManagementMutation(admin, { action: "provider-status", id: provider, status: "approved", reason: "All required application checks completed" });
    assert.equal((await c("marketplace_providers").findOne({ id: provider }))!.active, 1);
    const category = await c("categories").findOne({}); assert.ok(category);
    const service = { action: "service", slug: "qa-assigned-service", title: "Assigned QA service", category: String(category.slug), description: "A complete service used for assignment testing.", price: 250, durationMin: 45, image: "", includes: ["Agreed work scope"], active: true, providerIds: [provider] };
    await adminMutation(admin, service); assert.deepEqual((await c("services").findOne({ slug: service.slug }))!.provider_ids, [provider]);
    await assert.rejects(() => adminMutation(admin, { ...service, providerIds: [randomUUID()] }), /active approved/);
    await adminManagementMutation(admin, { action: "provider-status", id: provider, status: "suspended", reason: "Application needs additional review" });
    await assert.rejects(() => adminMutation(admin, { action: "provider", id: provider, active: true }), /Approve the provider application/);
    const replacement = await storeUpload({ ownerUserId: providerUser, purpose: "provider-document", documentType: "identity", originalName: "qa-new-identity.pdf", bytes: pdf }); await submitProviderDocument(providerUser, { uploadId: replacement.id, ...identity });
    assert.equal((await listProviderDocuments(providerUser)).documents.length, 1); assert.equal((await listProviderDocuments(providerUser)).status, "pending");

    const banner = { action: "banner", title: "QA banner", description: "Real announcement", image: "https://images.example.test/qa.jpg", ctaLabel: "View services", ctaPath: "/services", active: true };
    await adminMutation(admin, { ...banner, title: "QA banner one", position: 0 }); await adminMutation(admin, { ...banner, title: "QA banner two", position: 1 });
    const banners = await getActiveBanners(); await adminMutation(admin, { action: "banner-reorder", ids: [...banners].reverse().map(b => b.id) }); assert.equal((await getActiveBanners())[0].id, banners[1].id);
    await assert.rejects(() => adminMutation(admin, { action: "banner-reorder", ids: [banners[0].id, banners[0].id] }), /Reload/);

    await c("service_tokens").insertOne({ _id: `catalog:${booking}`, token: "TKN-20261025-0001", booking_id: booking, source: "catalog", customer_id: customer, created_at: now, queue_day: now.slice(0, 10), queue_status: "completed", assigned_provider_id: provider, queued_at: now, started_at: now, completed_at: now, wait_seconds: 300, service_seconds: 1800 });
    const today = now.slice(0, 10); const report = await adminReport(admin, { from: today, to: today }); assert.equal(report.rows.length, 1); assert.equal(report.metrics.collected, 321); assert.equal(report.metrics.refunded, 0); assert.ok(ledgerCsv(report.rows).includes("'=Formula customer"));
    assert.equal(report.metrics.averageWaitMinutes, 5); assert.equal(report.metrics.measuredWaits, 1); assert.equal(report.performance[0].averageServiceMinutes, 30); assert.equal(report.performance[0].completed, 1); assert.equal(report.performance[0].completionPercent, 100); assert.ok(operationsCsv(report, "tokens").includes("TKN-20261025-0001")); assert.ok(operationsCsv(report, "performance").includes("QA Provider"));
    await c("service_tokens").updateOne({ _id: `catalog:${booking}` }, { $unset: { wait_seconds: "" } }); const historicalReport = await adminReport(admin, { from: today, to: today }); assert.equal(historicalReport.metrics.averageWaitMinutes, null); assert.equal(historicalReport.metrics.measuredWaits, 0, "Unknown historical waits are not invented as zero");
    await assert.rejects(() => paymentReceipt(admin, "catalog", booking), /no recorded transaction/);
    const receiptId = randomUUID(); await c("cash_receipts").insertOne({ _id: receiptId, id: receiptId, source: "catalog", booking_id: booking, amount: 321, receipt_reference: "CASH-QA-0001", created_at: now });
    const receipt = await paymentReceipt(admin, "catalog", booking); assert.equal(receipt.reference, "CASH-QA-0001"); assert.equal((await receiptPdf(receipt)).subarray(0, 5).toString(), "%PDF-"); assert.equal((await reportPdf(report)).subarray(0, 5).toString(), "%PDF-");
    assert.throws(() => reportRange({ from: "2026-02-30", to: today }), /valid report dates/);
    await assert.rejects(() => adminRequestRefund(admin, { bookingId: booking, reason: "Cannot invent a cash gateway refund" }), /cancelled, paid gateway/); assert.equal(await c("payment_refunds").countDocuments(), 0);

    const races = await Promise.allSettled([adminManagementMutation(root, { action: "account-role", id: otherSuper, role: "ADMIN", reason: "Concurrent administrator role review" }), adminManagementMutation({ id: otherSuper, role: "SUPER_ADMIN" }, { action: "account-role", id: superId, role: "ADMIN", reason: "Concurrent administrator role review" })]);
    assert.equal(races.filter(r => r.status === "fulfilled").length, 1); assert.equal(await c("users").countDocuments({ role: "SUPER_ADMIN" }), 1);
    assert.ok(await c("platform_audit").countDocuments({ action: "account-role" }) >= 2); assert.equal(await c("platform_audit").countDocuments({ action: "provider-status", "details": /suspended/ }), 1);
  } finally { await fixture.close(); }
});
