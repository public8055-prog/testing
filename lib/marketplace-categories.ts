import { activeCatalogFilter, initDb } from "./db";
import { getMongoDb, mongoCollection } from "./mongo";
import type { Category } from "./types";

export type MarketplaceCategory = Category & {active?:boolean;archived?:boolean};
const initialized = new Map<string,Promise<void>>();
export async function ensureMarketplaceCategories(){
  await initDb();
  const key=(await getMongoDb()).databaseName;
  if(!initialized.has(key))initialized.set(key,(async()=>{
    const collection=await mongoCollection<{_id:string;slug:string}>("categories");
    await collection.createIndex({slug:1},{unique:true});
    // Categories are authored by administrators only; nothing is pre-seeded.
  })().catch(error=>{initialized.delete(key);throw error;}));
  return initialized.get(key)!;
}
export async function readMarketplaceCategories(includeInactive=false):Promise<MarketplaceCategory[]>{
  await ensureMarketplaceCategories();
  // Category approval is an authorization input: always use Mongo's current state here.
  const db=await getMongoDb();
  const rows=await db.collection<{_id:string;slug:string;payload:MarketplaceCategory}>("categories").aggregate<{payload:MarketplaceCategory;serviceCount:{count:number}[]}>([
    {$match:includeInactive?{}:activeCatalogFilter},{$sort:{slug:1}},
    {$lookup:{from:"services",let:{slug:"$slug"},pipeline:[{$match:{...activeCatalogFilter,$expr:{$eq:["$category","$$slug"]}}},{$count:"count"}],as:"serviceCount"}},
  ]).toArray();
  return rows.map(row=>({...row.payload,servicesCount:Number(row.serviceCount[0]?.count||0)}));
}
