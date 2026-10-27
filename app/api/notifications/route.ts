import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { acknowledgeNotification, listNotifications, sendCustomerNotification,sendAudienceNotification } from "@/lib/service-operations";
export const dynamic = "force-dynamic";
export async function GET() { try { return Response.json(await listNotifications((await requireUser()).id), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); } }
export async function PATCH(req: Request) {
  try { assertSameOrigin(req); const user = await requireUser(); await rateLimit(`notification-read:${user.id}`, 120, 60000); const data = z.object({ id: z.string().uuid(), action: z.enum(["read", "dismiss"]) }).strict().safeParse(await readJson(req)); if (!data.success) throw new HttpError(400, "Invalid update action."); await acknowledgeNotification(user.id, data.data.id, data.data.action); return Response.json({ ok: true }); } catch (error) { return apiError(error); }
}
export async function POST(req: Request) {
  try { assertSameOrigin(req); const admin = await requireAdmin(); await rateLimit(`notification-send:${admin.id}`, 30, 60000);const input=await readJson(req);if(input&&typeof input==="object"&&"target"in input)return Response.json({ok:true,...await sendAudienceNotification(admin,input)},{headers:{"Cache-Control":"no-store"}}); await sendCustomerNotification(admin,input); return Response.json({ ok: true }); } catch (error) { return apiError(error); }
}
