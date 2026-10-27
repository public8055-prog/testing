import { requireAdmin } from "@/lib/auth";
import { apiError, assertSameOrigin, rateLimit, readJson } from "@/lib/http";
import { listContacts, updateContact } from "@/lib/contact";
export async function GET(request: Request) {
  try { await requireAdmin(); return Response.json(await listContacts(Number(new URL(request.url).searchParams.get("page"))), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { assertSameOrigin(request); const user = await requireAdmin(); await rateLimit(`contact-admin:${user.id}`, 60, 60000); await updateContact(user.id, await readJson(request)); return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
