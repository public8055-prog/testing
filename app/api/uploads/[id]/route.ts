import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { apiError, HttpError } from "@/lib/http";
import { readUpload } from "@/lib/uploads";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { record, bucket } = await readUpload((await params).id);
    if (record.visibility === "private") { const user = await getCurrentUser(); if (!user || (user.id !== record.ownerUserId && !isAdminRole(user.role))) throw new HttpError(404, "File not found."); }
    const stream = bucket.openDownloadStream(record.fileId);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": record.mimeType, "Content-Length": String(record.size), "X-Content-Type-Options": "nosniff",
      "Cache-Control": record.visibility === "public" ? "public, max-age=86400, immutable" : "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${record.visibility === "private" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
    } });
  } catch (error) { return apiError(error); }
}
