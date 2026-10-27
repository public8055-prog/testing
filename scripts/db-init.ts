import { closeDb, databaseDriver, initDb } from "../lib/db";
import { mongoCollection, mongoHealth } from "../lib/mongo";
import { ensureMarketplace } from "../lib/marketplace";
import { initWorkforce } from "../lib/workforce";
import { ensurePlatform } from "../lib/platform";
import { backfillServiceTokens, ensureOperations } from "../lib/service-operations";
import { backfillServiceQueues } from "../lib/service-queue";
import { reviewLegacyProviderIdentity } from "../lib/provider-identity";
import { ensureActivityIndexes } from "../lib/admin-activity";
import { ensureBookingLocations } from "../lib/booking-location";

async function main() {
  try {
    await initDb();
    await ensureMarketplace();
    await initWorkforce();
    await ensurePlatform();
    await ensureOperations();
    await backfillServiceTokens();
    await backfillServiceQueues();
    await ensureBookingLocations();
    await ensureActivityIndexes();
    const identityReviews = await reviewLegacyProviderIdentity();
    if (identityReviews) console.log(`${identityReviews} provider profiles returned to identity review; existing bookings retained.`);
    if (!(await mongoHealth()).transactions) throw new Error("MongoDB replica set is required for transactions.");
    const counts: Record<string, number> = {};
    for (const name of ["services", "categories", "professionals"]) counts[name] = await (await mongoCollection(name)).countDocuments();
    console.log(`Database ready (${databaseDriver()}). Catalog:`, counts);
  } finally { await closeDb(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Database initialization failed"); process.exitCode = 1; });
