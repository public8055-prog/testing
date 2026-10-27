import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Collection, type Document, type InsertOneOptions, type OptionalUnlessRequiredId } from "mongodb";
import sharp from "sharp";
import { HttpError } from "../lib/http";
import { MAX_UPLOAD_BYTES, normalizeUpload, readUpload, storeUpload, validateUploadReference } from "../lib/uploads";
import { mongoFixture } from "./helpers/mongo-fixture";
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test("upload normalization rejects unsupported signatures and enforces byte and pixel bounds", async t => {
  await t.test("empty/oversized data and SVG/HTML/GIF never become images", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(MAX_UPLOAD_BYTES + 1)]) await assert.rejects(() => normalizeUpload(bytes, "banner"), status(413));
    for (const bytes of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), Buffer.from("<!doctype html><script>alert(1)</script>"), Buffer.from("GIF89a"), Buffer.from([255, 216, 255, 0, 0, 0]), Buffer.from("RIFFbrokenWEBP")]) await assert.rejects(() => normalizeUpload(bytes, "banner"), status(400));
  });
  await t.test("images are actually decoded, re-encoded and stripped of private metadata", async () => {
    const jpeg = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#338899" } }).withMetadata({ exif: { IFD0: { Artist: "QA private image metadata" } } }).jpeg().toBuffer();
    assert.ok((await sharp(jpeg).metadata()).exif);
    const normalized = await normalizeUpload(jpeg, "banner"), metadata = await sharp(normalized.bytes).metadata();
    assert.equal(normalized.mimeType, "image/webp"); assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 80); assert.equal(metadata.height, 40); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(normalized.bytes.includes(Buffer.from("QA private image metadata")), false);
    for (const format of ["png", "webp"] as const) { const bytes = await sharp({ create: { width: 24, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).toFormat(format).toBuffer(); assert.equal((await normalizeUpload(bytes, "provider-document")).mimeType, "image/webp"); }
  });
  await t.test("large dimensions are bounded before normalization and banner dimensions shrink", async () => {
    const wide = await sharp({ create: { width: 2000, height: 30, channels: 3, background: "#ffffff" } }).png().toBuffer();
    assert.equal((await sharp((await normalizeUpload(wide, "banner")).bytes).metadata()).width, 1920);
    const oversizedPixels = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "#ffffff" } }).png().toBuffer();
    assert.ok(oversizedPixels.length < MAX_UPLOAD_BYTES); await assert.rejects(() => normalizeUpload(oversizedPixels, "provider-document"), status(400));
  });
  await t.test("PDFs are private-document only and incomplete PDF input is rejected", async () => {
    assert.deepEqual(await normalizeUpload(pdf, "provider-document"), { bytes: pdf, mimeType: "application/pdf" });
    const exactLimit = Buffer.alloc(MAX_UPLOAD_BYTES, 32); Buffer.from("%PDF-1.4\n").copy(exactLimit); Buffer.from("%%EOF\n").copy(exactLimit, exactLimit.length - 6);
    assert.equal((await normalizeUpload(exactLimit, "provider-document")).bytes.length, MAX_UPLOAD_BYTES);
    await assert.rejects(() => normalizeUpload(pdf, "banner"), status(400)); await assert.rejects(() => normalizeUpload(Buffer.from("%PDF-1.4 incomplete"), "provider-document"), status(400));
  });
});

test("GridFS uploads preserve ownership/purpose, sanitize names and clean up failed metadata writes", async t => {
  const fixture = await mongoFixture("uploads"), owner = randomUUID(), other = randomUUID();
  try {
    await t.test("private reference ownership cannot be substituted or reused as a public banner", async () => {
      const stored = await storeUpload({ ownerUserId: owner, purpose: "provider-document", documentType: "identity", originalName: "../../qa<identity>\n\".pdf", bytes: pdf });
      assert.equal(stored.visibility, "private"); assert.equal(stored.originalName, "qaidentity.pdf"); assert.equal(stored.documentType, "identity"); assert.equal(stored.size, pdf.length);
      assert.equal((await validateUploadReference(stored.id, { ownerUserId: owner, purpose: "provider-document" })).id, stored.id);
      await assert.rejects(() => validateUploadReference(stored.id, { ownerUserId: other, purpose: "provider-document" }), status(400));
      await assert.rejects(() => validateUploadReference(stored.id, { purpose: "banner" }), status(400));
      await assert.rejects(() => readUpload("../../private-file"), status(404)); await assert.rejects(() => readUpload(randomUUID()), status(404));
      const { record, bucket } = await readUpload(stored.id), chunks: Buffer[] = []; for await (const chunk of bucket.openDownloadStream(record.fileId)) chunks.push(Buffer.from(chunk)); assert.deepEqual(Buffer.concat(chunks), pdf);
    });
    await t.test("public metadata contains the normalized MIME and no internal GridFS identifier", async () => {
      const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ffffff" } }).png().toBuffer();
      const stored = await storeUpload({ ownerUserId: owner, purpose: "banner", originalName: "qa.png", bytes: image }); assert.equal(stored.visibility, "public"); assert.equal(stored.mimeType, "image/webp"); assert.equal("fileId" in stored, false); assert.equal(stored.url, `/api/uploads/${stored.id}`);
      await assert.rejects(() => validateUploadReference(stored.id, { ownerUserId: owner, purpose: "provider-document" }), status(400));
    });
    await t.test("failed metadata persistence does not leave a downloadable GridFS orphan", async sub => {
      const before = await fixture.db.collection("assets.files").countDocuments(), original = Collection.prototype.insertOne;
      sub.mock.method(Collection.prototype, "insertOne", async function(this: Collection<Document>, document: OptionalUnlessRequiredId<Document>, options?: InsertOneOptions) {
        if (this.collectionName === "uploads") throw new Error("QA injected metadata failure");
        return original.call(this, document, options);
      });
      await assert.rejects(() => storeUpload({ ownerUserId: owner, purpose: "provider-document", originalName: "qa-failure.pdf", bytes: pdf }), /QA injected metadata failure/);
      assert.equal(await fixture.db.collection("assets.files").countDocuments(), before);
    });
  } finally { await fixture.close(); }
});
