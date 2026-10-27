import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { apiError, assertSameOrigin, HttpError, rateLimit, requestIp } from "@/lib/http";
import { MAX_UPLOAD_BYTES, storeUpload } from "@/lib/uploads";
import { mongoCollection } from "@/lib/mongo";
import { randomUUID } from "node:crypto";
export const runtime = "nodejs";
const schema = z.object({ purpose: z.enum(["banner", "provider-document"]), documentType: z.enum(["identity", "address", "qualification", "other"]).optional() });
export async function POST(req: Request) {
  try {
    assertSameOrigin(req); const user = await requireUser();
    await rateLimit(`upload:${user.id}:${requestIp(req)}`, 12, 3600000);
    const maximum = MAX_UPLOAD_BYTES + 65536;
    if (Number(req.headers.get("content-length") || 0) > maximum) throw new HttpError(413, "Choose a file no larger than 5 MB.");
    const reader = req.body?.getReader(); if (!reader) throw new HttpError(400, "Choose a file.");
    const chunks: Uint8Array[] = []; let total = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maximum) { await reader.cancel(); throw new HttpError(413, "Choose a file no larger than 5 MB."); } chunks.push(value); } } finally { reader.releaseLock(); }
    const payload = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
    let form: FormData; try { form = await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("content-type") || "" }, body: payload }).formData(); } catch { throw new HttpError(400, "Send a valid file upload."); }
    const parsed = schema.safeParse({ purpose: form.get("purpose"), documentType: form.get("documentType") || undefined });
    if (!parsed.success || form.getAll("file").length !== 1) throw new HttpError(400, "Choose a file and its purpose.");
    if (parsed.data.purpose === "banner" && !isAdminRole(user.role)) throw new HttpError(404, "Not found.");
    const file = form.get("file"); if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
    const result = await storeUpload({ ownerUserId: user.id, ...parsed.data, originalName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    const auditId = randomUUID();
    await (await mongoCollection("platform_audit")).insertOne({ _id: auditId, id: auditId, actor_id: user.id, action: "upload.created", target_id: result.id, details: JSON.stringify({ purpose: parsed.data.purpose, mimeType: result.mimeType, size: result.size }), created_at: new Date().toISOString() });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
