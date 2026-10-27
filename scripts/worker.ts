import { setTimeout as delay } from "node:timers/promises";
import { closeDb } from "../lib/db";
import { cleanupExpiredRecords, expirePendingBookings } from "../lib/maintenance";
import { processPendingRefunds } from "../lib/refunds";
import { runScheduledBackup } from "../lib/backups";
import { processPendingNotificationCampaigns } from "../lib/service-operations";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort());

async function main() {
  console.log("Maintenance worker started; interval 60 seconds.");
  try {
    while (!controller.signal.aborted) {
      try {
        const expiredBookings = await expirePendingBookings();
        const cleaned = await cleanupExpiredRecords();
        const refunds = await processPendingRefunds();
        await processPendingNotificationCampaigns();
        if (expiredBookings || cleaned.sessions || cleaned.rateLimits || refunds.processed) console.log("Maintenance activity:", { expiredBookings, ...cleaned, refunds });
      } catch { console.error("Maintenance cycle failed; the worker will retry on its next cycle."); }
      try { const backup = await runScheduledBackup(); if (backup.status === "created") console.log("Daily encrypted backup completed:", { collections: backup.collections, documents: backup.documents, bytes: backup.bytes }); }
      catch { console.error("Scheduled encrypted backup failed. Check its protected configuration and storage; the worker will retry next cycle."); }
      try { await delay(60_000, undefined, { signal: controller.signal }); } catch { /* Graceful shutdown. */ }
    }
  } finally { await closeDb(); console.log("Maintenance worker stopped."); }
}

main().catch(() => { console.error("Maintenance worker could not shut down cleanly."); process.exitCode = 1; });
