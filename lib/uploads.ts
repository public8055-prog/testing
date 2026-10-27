import { randomUUID } from "node:crypto";
import { GridFSBucket, ObjectId } from "mongodb";
import sharp from "sharp";
import { getMongoDb } from "./mongo";
import { HttpError } from "./http";

export type UploadPurpose = "banner" | "provider-document";
export type UploadRecord = { _id: string; id: string; fileId: ObjectId; ownerUserId: string; purpose: UploadPurpose; documentType?: "identity" | "address" | "qualification" | "other"; mimeType: string; size: number; originalName: string; visibility: "public" | "private"; createdAt: Date };
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const safeName = (name: string) => name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f"<>]/g, "").slice(0, 120) || "document";
export async function normalizeUpload(bytes: Buffer, purpose: UploadPurpose) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "Choose a file between 1 byte and 5 MB.");
  const pdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (pdf) {
    if (purpose !== "provider-document" || !bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from("%%EOF"))) throw new HttpError(400, "Choose a valid image or complete PDF document.");
    return { bytes, mimeType: "application/pdf" };
  }
  const image = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || (bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP");
  if (!image) throw new HttpError(400, "Choose a JPEG, PNG or WebP image, or a PDF for verification.");
  try {
    // Decode/re-encode accepted images: remove metadata and reject oversized pixel payloads.
    const result = await sharp(bytes, { limitInputPixels: 20_000_000, animated: false }).rotate().resize({ width: purpose === "banner" ? 1920 : 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (result.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "The processed image is too large.");
    return { bytes: result, mimeType: "image/webp" };
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "This image could not be decoded. Choose another file."); }
}
export async function storeUpload(input: { ownerUserId: string; purpose: UploadPurpose; documentType?: UploadRecord["documentType"]; originalName: string; bytes: Buffer }) {
  const normalized = await normalizeUpload(input.bytes, input.purpose), db = await getMongoDb(), id = randomUUID();
  const bucket = new GridFSBucket(db, { bucketName: "assets" });
  await db.collection<UploadRecord>("uploads").createIndex({ ownerUserId: 1, purpose: 1, createdAt: -1 });
  const stream = bucket.openUploadStream(id, { metadata: { purpose: input.purpose, contentType: normalized.mimeType } });
  await new Promise<void>((resolve, reject) => { stream.once("error", reject); stream.once("finish", resolve); stream.end(normalized.bytes); });
  const record: UploadRecord = { _id: id, id, fileId: stream.id, ownerUserId: input.ownerUserId, purpose: input.purpose, documentType: input.documentType, mimeType: normalized.mimeType, size: normalized.bytes.length, originalName: safeName(input.originalName), visibility: input.purpose === "banner" ? "public" : "private", createdAt: new Date() };
  try { await db.collection<UploadRecord>("uploads").insertOne(record); }
  catch (error) { await bucket.delete(stream.id).catch(() => undefined); throw error; }
  return publicUpload(record);
}
export function publicUpload(record: UploadRecord) { return { id: record.id, url: `/api/uploads/${record.id}`, mimeType: record.mimeType, size: record.size, originalName: record.originalName, visibility: record.visibility, ownerUserId: record.ownerUserId, documentType: record.documentType }; }
export async function validateUploadReference(id: string, expected: { ownerUserId?: string; purpose: UploadPurpose }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Choose an uploaded file.");
  const record = await (await getMongoDb()).collection<UploadRecord>("uploads").findOne({ id, purpose: expected.purpose, ...(expected.ownerUserId ? { ownerUserId: expected.ownerUserId } : {}) });
  if (!record) throw new HttpError(400, "The uploaded file does not belong to this request.");
  return publicUpload(record);
}
export async function readUpload(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "File not found.");
  const db = await getMongoDb(), record = await db.collection<UploadRecord>("uploads").findOne({ id });
  if (!record) throw new HttpError(404, "File not found.");
  return { record, bucket: new GridFSBucket(db, { bucketName: "assets" }) };
}
