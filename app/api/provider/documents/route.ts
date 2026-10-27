import { requireAdmin, requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
import { listProviderDocuments, submitProviderDocument } from "@/lib/admin-management";
import { ensurePlatform } from "@/lib/platform";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { try { await ensurePlatform(); const user = await requireUser(), id = new URL(req.url).searchParams.get("providerId"); return Response.json(id ? await listProviderDocuments(id, await requireAdmin()) : await listProviderDocuments(user.id), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); } }
export async function POST(req: Request) { try { assertSameOrigin(req); await ensurePlatform(); const user = await requireUser(); await rateLimit(`provider-document:${user.id}`, 15, 60000); await submitProviderDocument(user.id, await readJson(req)); return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); } }
