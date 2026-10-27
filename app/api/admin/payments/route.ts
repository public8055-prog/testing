import { requireAdmin } from "@/lib/auth";
import { apiError, assertSameOrigin, HttpError, rateLimit, readJson } from "@/lib/http";
import { adminRequestRefund, paymentReceipt } from "@/lib/admin-reports";
import { receiptPdf } from "@/lib/admin-pdf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try { const actor = await requireAdmin(), q = new URL(req.url).searchParams, source = q.get("source"); if (source !== "catalog" && source !== "provider") throw new HttpError(400, "Choose a booking source."); const receipt = await paymentReceipt(actor, source, q.get("id") || ""); return new Response(new Uint8Array(await receiptPdf(receipt)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=urbankare-payment-receipt.pdf", "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function POST(req: Request) {
  try { assertSameOrigin(req); const actor = await requireAdmin(); await rateLimit(`admin-refund:${actor.id}`, 10, 60000); return Response.json(await adminRequestRefund(actor, await readJson(req)), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
