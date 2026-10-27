import { NextResponse } from "next/server";
import { sharedRateLimit, DistributedLockError } from "@/lib/redis";
import { logEvent } from "@/lib/logger";
import { isAllowedRequestOrigin, publicRequestUrl } from "@/lib/request-origin";

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError || error instanceof DistributedLockError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
  logEvent("error", "request.failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!isAllowedRequestOrigin(publicRequestUrl(req.url), origin, process.env.APP_URL) || req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Request origin is not allowed. Open the app directly and try again.");
}
export async function readJson(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 32768) throw new HttpError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Invalid JSON.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) { await reader.cancel(); throw new HttpError(413, "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(content); } catch { throw new HttpError(400, "Invalid JSON encoding."); }
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "Invalid JSON."); }
}
export async function rateLimit(key: string, limit: number, windowMs: number) {
  let result;
  try { result = await sharedRateLimit(key, limit, windowMs); }
  catch { throw new HttpError(503, "Requests are temporarily unavailable. Please try again shortly.", 5); }
  if (!result.allowed) throw new HttpError(429, "Too many requests. Please try again shortly.", Math.max(1, result.retryAfter));
}
export function requestIp(req: Request) {
  // Only trust forwarded headers behind an explicitly configured trusted proxy.
  return process.env.TRUST_PROXY === "true" ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown") : "local";
}
