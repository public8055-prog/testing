import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { listAdminUsers, adminUserDetails } from "@/lib/admin-management";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { const actor = await requireAdmin(), query = new URL(req.url).searchParams; const data = query.get("id") ? await adminUserDetails(actor, query.get("id")!) : await listAdminUsers(actor, Object.fromEntries(query)); return Response.json(data, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
