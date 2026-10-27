import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mongoFixture } from "./helpers/mongo-fixture";
import { createContact, listContacts, updateContact } from "../lib/contact";
test("contact requests require explicit consent, retain minimal data and restrict administration", async () => {
  const fixture = await mongoFixture("contact");
  try {
    const input = { name: "QA contact", email: "contact@example.test", subject: "Privacy request", message: '<script>window.example = true</script> Please explain my stored information.', consent: true, website: "" };
    for (const invalid of [{ ...input, consent: false }, { ...input, consent: "true" }, { ...input, website: "https://spam.example" }, { ...input, email: { $ne: null } }]) await assert.rejects(() => createContact(invalid));
    assert.equal(await fixture.db.collection("contact_requests").countDocuments(), 0);
    const result = await createContact(input); assert.match(result.reference, /^UK-HELP-[0-9A-F]{8}$/);
    const saved = await fixture.db.collection("contact_requests").findOne({ reference: result.reference }); assert.ok(saved); assert.ok(saved.expires_at instanceof Date); assert.ok(saved.consent_at); assert.equal(saved.privacy_version, "2026-10-25"); assert.equal("ip" in saved, false); assert.equal(saved.message, input.message, "Text is kept as plain text and must be escaped by React, not executed as HTML.");
    const userId = "contact-admin"; await fixture.seedUser(userId); await assert.rejects(() => updateContact(userId, { id: saved._id, status: "resolved" }));
    await fixture.users.updateOne({ id: userId }, { $set: { role: "admin" } }); await updateContact(userId, { id: saved._id, status: "reviewing" }); assert.equal((await listContacts(1)).rows[0].status, "reviewing");
    await fixture.db.collection("platform_account_status").insertOne({ user_id: userId, active: 0 }); await assert.rejects(() => updateContact(userId, { id: saved._id, status: "resolved" }));
    assert.equal(await fixture.db.collection("platform_audit").countDocuments({ action: "contact.status" }), 1);
  } finally { await fixture.close(); }
});
