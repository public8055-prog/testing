import PDFDocument from "pdfkit";
import type { adminReport, paymentReceipt } from "./admin-reports";

async function documentBuffer(write: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const pdf = new PDFDocument({ margin: 44, size: "A4", info: { Title: "SanjuNow administrative record" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { pdf.on("data", chunk => chunks.push(Buffer.from(chunk))); pdf.on("error", reject); pdf.on("end", () => resolve(Buffer.concat(chunks))); });
  write(pdf); pdf.end(); return result;
}
export async function reportPdf(report: Awaited<ReturnType<typeof adminReport>>) {
  return documentBuffer(pdf => {
    pdf.fontSize(21).fillColor("#142b3b").text("SanjuNow operations report");
    pdf.moveDown().fontSize(10).fillColor("#334155").text(`Booking cohort: ${report.from} to ${report.to} (UTC). Generated ${new Date().toISOString()}`);
    pdf.moveDown().text(`Bookings: ${report.metrics.bookings}    Completed: ${report.metrics.completed}`);
    pdf.text(`Collected INR ${report.metrics.collected.toFixed(2)}    Confirmed refunds INR ${report.metrics.refunded.toFixed(2)}    Net INR ${report.metrics.netCollected.toFixed(2)}`);
    pdf.moveDown().fontSize(9).text("Amounts are booking totals in INR. Refunds reflect their current gateway-confirmed status for this booking cohort.");
    pdf.moveDown().text(`Measured queue waits: ${report.metrics.measuredWaits}. Average wait: ${report.metrics.averageWaitMinutes === null ? "No measured data" : `${report.metrics.averageWaitMinutes} minutes`}. Wait runs from queue entry to service start; advance booking time can be included.`);
    pdf.moveDown().fontSize(13).text("Provider performance");
    if (!report.performance.length) pdf.fontSize(9).text("No assigned provider records for this booking cohort.");
    for (const r of report.performance) { if (pdf.y > 690) pdf.addPage(); pdf.moveDown().fontSize(10).text(r.provider); pdf.fontSize(9).text(`Assigned ${r.assigned}; completed ${r.completed} (${r.completionPercent}%); cancelled ${r.cancelled}; no-shows ${r.noShows}.`).text(`Average wait: ${r.averageWaitMinutes ?? "Not measured"} min; average completed service: ${r.averageServiceMinutes ?? "Not measured"} min.`); }
    pdf.addPage().fontSize(13).text("Transaction ledger");
    for (const r of report.rows) { if (pdf.y > 710) pdf.addPage(); pdf.moveDown().fontSize(10).fillColor("#142b3b").text(`${r.source.toUpperCase()} ${r.id}`); pdf.fontSize(9).fillColor("#334155").text(`${r.customer} | INR ${r.amount.toFixed(2)} | ${r.status} | ${r.createdAt}`).text(`Transaction: ${r.transactionId || "No confirmed reference"}${r.refundStatus ? ` | Refund: ${r.refundStatus}` : ""}`); }
    if (report.tokenRows.length) { pdf.addPage().fontSize(13).text("Token wait and service records"); for (const r of report.tokenRows) { if (pdf.y > 690) pdf.addPage(); pdf.moveDown().fontSize(10).text(`${r.token} | ${r.day} | ${r.status}`); pdf.fontSize(9).text(`${r.provider} | Wait ${r.waitMinutes ?? "Not measured"} min | Service ${r.serviceMinutes ?? "Not measured"} min`).text(`Booking ${r.bookingId} | ${r.source}`); } }
  });
}
export async function receiptPdf(receipt: Awaited<ReturnType<typeof paymentReceipt>>) {
  return documentBuffer(pdf => {
    pdf.fontSize(22).fillColor("#142b3b").text("SanjuNow payment receipt"); pdf.moveDown().fontSize(11).fillColor("#334155");
    for (const [label, value] of [["Transaction reference", receipt.reference], ["Booking", receipt.id], ["Source", receipt.source], ["Customer", receipt.customer], ["Amount", `INR ${receipt.amount.toFixed(2)}`], ["Payment method", receipt.method], ["Current status", receipt.status], ["Recorded at (UTC)", receipt.issuedAt]]) pdf.moveDown().text(`${label}: ${value}`);
    pdf.moveDown(2).fontSize(9).text("This confirms a recorded payment and is not a tax invoice. Contact support for a statutory invoice or reconciliation.");
  });
}
