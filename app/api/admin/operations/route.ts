import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { addServiceFollowup, listTrackedServices, recordCashReceipt, updateTrackedStatus } from "@/lib/service-operations";
import { mongoCollection } from "@/lib/mongo";
import { ADMIN_ROLES } from "@/lib/roles";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(), params = new URL(req.url).searchParams;
    const [tracking, customers] = await Promise.all([listTrackedServices(admin, { admin: true, token: params.get("token") || undefined,tokenId:params.get("tokenId")||undefined, page: Number(params.get("page")) || 1 }), (await mongoCollection("users")).find({ role: { $nin:[...ADMIN_ROLES] } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).sort({ name: 1 }).limit(300).toArray()]);
    return Response.json({ ...tracking, customers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("followup"), token: z.string().max(60), version: z.number().int().nonnegative(), message: z.string().max(1500), nextFollowupAt: z.string().datetime().nullable(), notify: z.boolean() }),
  z.object({ action: z.literal("status"), token: z.string().max(60), status: z.enum(["confirmed", "in_progress", "completed", "cancelled"]) }),
  z.object({ action: z.literal("cash"), token: z.string().max(60), receiptReference: z.string().max(80), amount: z.number().int().positive() }),
]);
export async function PATCH(req: Request) {
  try {
    assertSameOrigin(req); const admin = await requireAdmin(); await rateLimit(`operations:${admin.id}`, 60, 60000);
    const parsed = actions.safeParse(await readJson(req)); if (!parsed.success) throw new HttpError(400, "Check the submitted operation.");
    const { action, ...data } = parsed.data;
    if (action === "followup") await addServiceFollowup(admin, data);
    else if (parsed.data.action === "status") await updateTrackedStatus(admin, parsed.data.token, parsed.data.status);
    else if (parsed.data.action === "cash") await recordCashReceipt(admin, parsed.data.token, parsed.data.receiptReference, parsed.data.amount);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
