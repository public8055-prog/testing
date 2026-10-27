import { closeDb } from "../lib/db";
import { cleanupExpiredRecords, expirePendingBookings } from "../lib/maintenance";
import { processPendingRefunds } from "../lib/refunds";
import { processPendingNotificationCampaigns } from "../lib/service-operations";

async function main() {
  try {
    const expiredBookings = await expirePendingBookings();
    const cleaned = await cleanupExpiredRecords();
    const refunds = await processPendingRefunds();
    await processPendingNotificationCampaigns();
    console.log("Maintenance complete:", { expiredBookings, ...cleaned, refunds });
  } finally { await closeDb(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Maintenance failed"); process.exitCode = 1; });
