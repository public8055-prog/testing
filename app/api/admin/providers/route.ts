import { requireAdmin } from "@/lib/auth";
import { addAdminProvider } from "@/lib/admin-providers";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(req: Request) { try { assertSameOrigin(req); const actor = await requireAdmin(); await rateLimit(`admin-add-provider:${actor.id}`, 10, 600000); return Response.json(await addAdminProvider(actor, await readJson(req)), { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); } }
