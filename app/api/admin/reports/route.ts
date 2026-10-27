import { requireAdmin } from "@/lib/auth";
import { apiError, rateLimit } from "@/lib/http";
import { adminReport, ledgerCsv, operationsCsv } from "@/lib/admin-reports";
import { reportPdf } from "@/lib/admin-pdf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const actor = await requireAdmin(); await rateLimit(`admin-report:${actor.id}`, 30, 60000); const q = new URL(req.url).searchParams, data = await adminReport(actor, Object.fromEntries(q)), format = q.get("format");
    if (format === "csv") { const view = q.get("view"), content = view === "tokens" || view === "performance" ? operationsCsv(data, view) : ledgerCsv(data.rows); return new Response(content, { headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": `attachment; filename="urbankare-report-${view === "tokens" || view === "performance" ? view : "ledger"}-${data.from}-${data.to}.csv"`, "Cache-Control": "no-store" } }); }
    if (format === "pdf") return new Response(new Uint8Array(await reportPdf(data)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="urbankare-report-${data.from}-${data.to}.pdf"`, "Cache-Control": "no-store" } });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
