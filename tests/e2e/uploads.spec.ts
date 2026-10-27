import { test, expect } from "./fixtures";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import sharp from "sharp";
import type { Document } from "mongodb";

test("upload API enforces signatures, size limits, public permissions and private document ownership", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  test.skip(!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname), "Trusted upload fixtures require a local application.");
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  test.skip(!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.MONGODB_URI || ""), "Trusted upload fixtures require local MongoDB.");
  const { bootstrapAdministrator } = await import("../../lib/admin-bootstrap"), { getMongoDb, closeMongo } = await import("../../lib/mongo"), { closeRedis } = await import("../../lib/redis");
  const db = await getMongoDb(), users = db.collection<Document & { _id: string }>("users"), contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ baseURL }))), [owner, outsider, admin, guest] = contexts;
  const password = `QA-${randomUUID()}!`, stamp = randomUUID(), alias = `qa-upload-admin-${stamp}#example.test`, ids: string[] = [];
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#226677" } }).png().toBuffer(), pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"), headers = { Origin: baseURL! };
  try {
    for (const [index, context] of [owner, outsider].entries()) { const email = `qa-upload-${index}-${stamp}@example.test`; const r = await context.request.post("/api/auth/register", { headers, data: { name: "QA upload account", email, password, termsAccepted: true, privacyConsent: true, adultConfirmed: true } }); expect(r.status()).toBe(201); ids.push(String((await users.findOne({ email }))!.id)); }
    ids.push((await bootstrapAdministrator(alias, password, "QA Upload Administrator")).id); expect((await admin.request.post("/api/auth/login", { headers, data: { email: alias, password } })).status()).toBe(200);
    const file = (buffer: Buffer, name = "qa.png", mimeType = "image/png") => ({ name, mimeType, buffer });
    expect((await owner.request.post("/api/uploads", { headers, multipart: { purpose: "banner", file: file(png) } })).status()).toBe(404);
    expect((await guest.request.post("/api/uploads", { headers, multipart: { purpose: "provider-document", file: file(pdf, "qa.pdf", "application/pdf") } })).status()).toBe(401);
    for (const bytes of [Buffer.from("<svg><script>alert(1)</script></svg>"), Buffer.from("<html>Not an image</html>"), Buffer.from([255, 216, 255, 0])]) expect((await owner.request.post("/api/uploads", { headers, multipart: { purpose: "provider-document", file: file(bytes) } })).status()).toBe(400);
    expect((await owner.request.post("/api/uploads", { headers, multipart: { purpose: "provider-document", file: file(Buffer.alloc(5 * 1024 * 1024 + 1), "too-large.pdf", "application/pdf") } })).status()).toBe(413);
    expect((await admin.request.post("/api/uploads", { headers, multipart: { purpose: "banner", file: file(pdf, "qa.pdf", "application/pdf") } })).status()).toBe(400);
    const uploaded = await owner.request.post("/api/uploads", { headers, multipart: { purpose: "provider-document", documentType: "identity", file: file(pdf, "qa-identity.pdf", "application/pdf") } }); expect(uploaded.status()).toBe(201); const document = await uploaded.json(); expect(document.visibility).toBe("private");
    for (const context of [guest, outsider]) for (const method of ["GET", "HEAD"]) { const denied = await context.request.fetch(document.url, { method }); expect(denied.status()).toBe(404); expect(denied.headers()["cache-control"]).toContain("no-store"); }
    for (const context of [owner, admin]) for (const method of ["GET", "HEAD"]) { const response = await context.request.fetch(document.url, { method }); expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); expect(response.headers()["content-disposition"]).toContain("attachment"); expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox"); expect(response.headers()["x-content-type-options"]).toBe("nosniff"); expect(await response.body()).toEqual(method === "HEAD" ? Buffer.alloc(0) : pdf); }
    const imageUpload = await admin.request.post("/api/uploads", { headers, multipart: { purpose: "banner", file: file(png) } }); expect(imageUpload.status()).toBe(201); const image = await imageUpload.json(); expect(image.mimeType).toBe("image/webp"); expect(image.visibility).toBe("public");
    for (const method of ["GET", "HEAD"]) { const imageResponse = await guest.request.fetch(image.url, { method }); expect(imageResponse.status()).toBe(200); expect(imageResponse.headers()["cache-control"]).toBe("public, max-age=86400, immutable"); expect(imageResponse.headers()["content-type"]).toBe("image/webp"); expect(imageResponse.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox"); if (method === "GET") expect((await sharp(await imageResponse.body()).metadata()).format).toBe("webp"); else expect(await imageResponse.body()).toHaveLength(0); }
    const leak = await admin.request.patch("/api/platform", { headers, data: { action: "banner", title: "Must not publish private document", description: "QA cross-purpose denial", image: document.url, imageUploadId: document.id, ctaLabel: "View services", ctaPath: "/services", active: true } }); expect(leak.status()).toBe(400);
    for (const path of [`/api/uploads/${randomUUID()}`, "/api/uploads/not-an-upload-id"]) for (const method of ["GET", "HEAD"]) { const missing = await guest.request.fetch(path, { method }); expect(missing.status()).toBe(404); expect(missing.headers()["cache-control"]).toContain("no-store"); }
  } finally {
    for (const id of ids) { await db.collection("sessions").deleteMany({ user_id: id }); await db.collection<Document & { _id: string }>("platform_account_status").updateOne({ user_id: id }, { $set: { active: 0 }, $setOnInsert: { _id: id, user_id: id } }, { upsert: true }); }
    await Promise.all(contexts.map(c => c.close())); await closeRedis(); await closeMongo();
  }
});
