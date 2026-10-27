import type { Document } from "mongodb";
import { z } from "zod";
import { getMongoDb, withMongoTransaction } from "./mongo";
import { HttpError } from "./http";
import { recordAdminAudit, requirePersistedAdmin, type AdminActor } from "./admin-access";
import { requestBookingRefund } from "./refunds";

type Row = Document & { _id: string };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const querySchema = z.object({ from: date, to: date, status: z.enum(["all", "paid", "unpaid", "failed", "refund_pending", "refunded"]).default("all"), source: z.enum(["all", "catalog", "provider"]).default("all") });
export function reportRange(input: unknown) {
  const parsed = querySchema.safeParse(input); if (!parsed.success) throw new HttpError(400, "Choose valid report dates and filters.");
  const p = parsed.data, start = new Date(p.from), end = new Date(p.to); end.setUTCDate(end.getUTCDate() + 1);
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000) throw new HttpError(400, "Choose a date range of up to one year.");
  return { ...p, start: start.toISOString(), end: end.toISOString() };
}
export type LedgerEntry = { id: string; source: "catalog" | "provider"; customer: string; customerId: string; provider: string; transactionId: string; amount: number; status: string; bookingStatus: string; createdAt: string; receipt: string; refundStatus: string; refundAmount: number; canRequestRefund: boolean };

export async function adminReport(actor: AdminActor, input: unknown) {
  await requirePersistedAdmin(actor); const p = reportRange(input), db = await getMongoDb(), match = { created_at: { $gte: p.start, $lt: p.end }, ...(p.status === "all" ? {} : { payment_status: p.status }) };
  const [catalog, provider] = await Promise.all([
    p.source === "provider" ? [] : db.collection<Row>("bookings").find(match).sort({ created_at: -1 }).limit(10001).toArray(),
    p.source === "catalog" ? [] : db.collection<Row>("marketplace_bookings").find(match).sort({ created_at: -1 }).limit(10001).toArray(),
  ]);
  if (catalog.length + provider.length > 10000) throw new HttpError(400, "This report exceeds 10,000 records. Choose a shorter date range.");
  const ids = [...catalog, ...provider].map(b => b.id), userIds = [...catalog, ...provider].map(b => b.user_id || b.customer_id);
  const [receipts, refunds, users, queue, tokens] = await Promise.all([
    db.collection<Row>("cash_receipts").find({ booking_id: { $in: ids } }).toArray(),
    db.collection<Row>("payment_refunds").find({ booking_id: { $in: catalog.map(b => b.id) } }).toArray(),
    db.collection<Row>("users").find({ id: { $in: userIds } }, { projection: { id: 1, name: 1 } }).toArray(),
    db.collection<Row>("service_tokens").aggregate<{ _id: string; count: number }>([{ $match: { created_at: { $gte: p.start, $lt: p.end } } }, { $group: { _id: "$queue_status", count: { $sum: 1 } } }]).toArray(),
    db.collection<Row>("service_tokens").find({ $or: [{ source: "catalog", booking_id: { $in: catalog.map(b => b.id) } }, { source: "provider", booking_id: { $in: provider.map(b => b.id) } }] }, { projection: { token: 1, booking_id: 1, source: 1, queue_status: 1, queue_day: 1, assigned_provider_id: 1, queued_at: 1, started_at: 1, completed_at: 1, wait_seconds: 1, service_seconds: 1 } }).toArray(),
  ]);
  const entry = (b: Row, source: "catalog" | "provider"): LedgerEntry => {
    const cash = receipts.find(r => r.booking_id === b.id && r.source === source), refund = source === "catalog" ? refunds.find(r => r.booking_id === b.id) : null;
    const gateway = String(b.payment_provider || b.payment || "pending");
    return { id: String(b.id), source, customer: String(b.name || b.customer_name || users.find(u => u.id === b.customer_id)?.name || "Customer"), customerId: String(b.user_id || b.customer_id), provider: gateway, transactionId: String(b.razorpay_payment_id || b.stripe_payment_intent_id || cash?.receipt_reference || ""), amount: Number(b.total), status: String(b.payment_status), bookingStatus: String(b.status), createdAt: String(b.created_at), receipt: String(cash?.receipt_reference || ""), refundStatus: String(refund?.status || ""), refundAmount: Number(refund?.amount || 0) / 100, canRequestRefund: source === "catalog" && b.status === "cancelled" && ["paid", "refund_pending"].includes(b.payment_status) && ["stripe", "razorpay"].includes(gateway) && refund?.status !== "succeeded" };
  };
  const rows = [...catalog.map(b => entry(b, "catalog")), ...provider.map(b => entry(b, "provider"))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const collected = rows.filter(r => ["paid", "refund_pending", "refunded"].includes(r.status)).reduce((s, r) => s + r.amount, 0), refunded = refunds.filter(r => r.status === "succeeded").reduce((s, r) => s + Number(r.amount) / 100, 0);
  const names = new Map((await db.collection<Row>("marketplace_providers").find({ id: { $in: [...new Set(tokens.map(t => t.assigned_provider_id).filter(Boolean))] } }, { projection: { id: 1, display_name: 1 } }).toArray()).map(row => [String(row.id), String(row.display_name)]));
  const duration = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value / 6) / 10 : null;
  const tokenRows = tokens.map(t => ({ token: String(t.token), bookingId: String(t.booking_id), source: String(t.source), day: String(t.queue_day || ""), status: String(t.queue_status || "unknown"), providerId: String(t.assigned_provider_id || ""), provider: t.assigned_provider_id ? names.get(String(t.assigned_provider_id)) || "Archived provider" : "Unassigned", queuedAt: String(t.queued_at || ""), startedAt: String(t.started_at || ""), completedAt: String(t.completed_at || ""), waitMinutes: duration(t.wait_seconds), serviceMinutes: duration(t.service_seconds) }));
  const average = (values: Array<number | null>) => { const measured = values.filter((v): v is number => v !== null); return measured.length ? Math.round(measured.reduce((sum, v) => sum + v, 0) / measured.length * 10) / 10 : null; };
  const performance = [...new Set(tokenRows.filter(t => t.providerId).map(t => t.providerId))].map(providerId => {
    const assigned = tokenRows.filter(t => t.providerId === providerId), completed = assigned.filter(t => t.status === "completed").length;
    return { providerId, provider: names.get(providerId) || "Archived provider", assigned: assigned.length, completed, cancelled: assigned.filter(t => t.status === "cancelled").length, noShows: assigned.filter(t => t.status === "no_show").length, completionPercent: Math.round(completed / assigned.length * 1000) / 10, averageWaitMinutes: average(assigned.map(t => t.waitMinutes)), averageServiceMinutes: average(assigned.filter(t => t.status === "completed").map(t => t.serviceMinutes)) };
  }).sort((a, b) => b.completed - a.completed || a.provider.localeCompare(b.provider));
  return { from: p.from, to: p.to, rows, tokenRows, performance, metrics: { bookings: rows.length, completed: rows.filter(r => r.bookingStatus === "completed").length, collected, refunded, netCollected: collected - refunded, activeQueue: queue.filter(q => ["waiting", "called", "in_service"].includes(q._id)).reduce((s, q) => s + q.count, 0), averageWaitMinutes: average(tokenRows.map(t => t.waitMinutes)), measuredWaits: tokenRows.filter(t => t.waitMinutes !== null).length } };
}

export function operationsCsv(report: Awaited<ReturnType<typeof adminReport>>, view: "tokens" | "performance") {
  const columns = view === "tokens" ? ["token", "bookingId", "source", "day", "status", "provider", "queuedAt", "startedAt", "completedAt", "waitMinutes", "serviceMinutes"] : ["providerId", "provider", "assigned", "completed", "cancelled", "noShows", "completionPercent", "averageWaitMinutes", "averageServiceMinutes"];
  const records: Record<string, unknown>[] = view === "tokens" ? report.tokenRows : report.performance;
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [columns.map(cell).join(","), ...records.map(row => columns.map(k => cell(row[k])).join(","))].join("\r\n");
}

export function ledgerCsv(rows: LedgerEntry[]) {
  const columns: (keyof LedgerEntry)[] = ["id", "source", "customer", "provider", "transactionId", "amount", "status", "bookingStatus", "createdAt", "receipt", "refundStatus", "refundAmount"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [columns.map(cell).join(","), ...rows.map(row => columns.map(k => cell(row[k])).join(","))].join("\r\n");
}

export async function adminRequestRefund(actor: AdminActor, input: unknown) {
  const p = z.object({ bookingId: z.string().min(1).max(100), reason: z.string().trim().min(10).max(500) }).safeParse(input); if (!p.success) throw new HttpError(400, "Include a booking and a refund reason of at least ten characters.");
  const db = await getMongoDb();
  await withMongoTransaction(async session => {
    await db.collection<Row>("platform_locks").updateOne({ _id: "admin-mutations" }, { $inc: { version: 1 } }, { session, upsert: true });
    await requirePersistedAdmin(actor, session);
    const b = await db.collection<Row>("bookings").findOneAndUpdate({ id: p.data.bookingId }, { $inc: { payment_version: 1 } }, { session, returnDocument: "after" });
    if (!b || b.status !== "cancelled" || !["paid", "refund_pending"].includes(b.payment_status) || !["stripe", "razorpay"].includes(String(b.payment_provider))) throw new HttpError(409, "Only a cancelled, paid gateway booking can request a refund. Cash refunds require support reconciliation.");
    await recordAdminAudit(actor, "refund-request", p.data.bookingId, { reason: p.data.reason, amount: b.total, gateway: b.payment_provider }, session);
  });
  await requestBookingRefund(p.data.bookingId);
  const refund = await db.collection<Row>("payment_refunds").findOne({ booking_id: p.data.bookingId });
  return { status: String(refund?.status || "pending"), message: refund?.status === "succeeded" ? "The gateway confirmed this refund." : "Refund requested. Its final state comes from the payment gateway." };
}

export async function paymentReceipt(actor: AdminActor, source: "catalog" | "provider", id: string) {
  await requirePersistedAdmin(actor); const db = await getMongoDb(), b = await db.collection<Row>(source === "catalog" ? "bookings" : "marketplace_bookings").findOne({ id });
  if (!b || !["paid", "refunded", "refund_pending"].includes(b.payment_status)) throw new HttpError(404, "A confirmed payment receipt is not available.");
  const cash = await db.collection<Row>("cash_receipts").findOne({ source, booking_id: id });
  const reference = String(cash?.receipt_reference || b.razorpay_payment_id || b.stripe_payment_intent_id || "");
  if (!reference) throw new HttpError(404, "The payment has no recorded transaction reference.");
  return { id, source, reference, customer: String(b.name || b.customer_name || "Customer"), amount: Number(b.total), status: String(b.payment_status), method: String(b.payment_provider || b.payment || "cash"), issuedAt: String(cash?.created_at || b.updated_at || b.created_at) };
}
