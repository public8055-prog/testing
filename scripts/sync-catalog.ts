import { closeDb, initDb, parsePayload } from "../lib/db";
import { services, categories } from "../lib/data";
import { mongoCollection, withMongoTransaction } from "../lib/mongo";
import { invalidateCatalogCache } from "../lib/redis";

/** Explicitly refresh authored service copy, never administrator prices, categories or publication controls. */
export async function syncAuthoredCatalog() {
  await initDb();
  await invalidateCatalogCache();
  await withMongoTransaction(async session => {
    await (await mongoCollection("app_locks")).updateOne({ _id: "catalog" }, { $inc: { version: 1 } }, { session });
    const categoryCollection = await mongoCollection("categories"), serviceCollection = await mongoCollection("services");
    for (const category of categories) {
      // Existing labels, descriptions and archive flags belong to the administrator.
      await categoryCollection.updateOne({ slug: category.slug }, { $setOnInsert: { _id: category.slug, slug: category.slug, payload: { ...category, servicesCount: services.filter(service => service.category === category.slug).length } } }, { upsert: true, session });
    }
    for (const service of services) {
      const stored = await serviceCollection.findOne({ slug: service.slug }, { session });
      if (!stored) {
        await serviceCollection.insertOne({ _id: service.slug, slug: service.slug, category: service.category, price: service.price, payload: service }, { session });
        continue;
      }
      const oldPayload = parsePayload<Record<string, unknown>>(stored.payload);
      // This allowlist is the content-refresh contract. Do not spread authored data over persisted controls.
      const copy = { title: service.title, description: service.description, includes: service.includes, faqs: service.faqs, image: service.image, preparation: service.preparation || [], exclusions: service.exclusions || [], serviceSteps: service.serviceSteps || [], bookingUnit: service.bookingUnit || oldPayload.bookingUnit };
      const payload = { ...oldPayload, ...copy, slug: stored.slug, category: stored.category, price: stored.price };
      await serviceCollection.updateOne({ _id: stored._id }, { $set: { payload } }, { session });
    }
  });
  await invalidateCatalogCache();
  return { services: services.length, categories: categories.length };
}

if (process.argv[1] && /[\\/]sync-catalog\.(?:ts|js)$/.test(process.argv[1])) {
  syncAuthoredCatalog().then(result => console.log(`Authored copy refreshed for ${result.services} services. Existing administrator prices, categories and publication controls preserved.`))
    .catch(error => { console.error(error instanceof Error ? error.message : "Catalog sync failed"); process.exitCode = 1; }).finally(closeDb);
}
