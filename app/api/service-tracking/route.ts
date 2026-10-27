import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { listTrackedServices } from "@/lib/service-operations";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { const user = await requireUser(), params = new URL(req.url).searchParams; return Response.json(await listTrackedServices(user, { token: params.get("token") || undefined,tokenId:params.get("tokenId")||undefined, page: Number(params.get("page")) || 1, active: params.get("active") === "1" }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiError(error); }
}
