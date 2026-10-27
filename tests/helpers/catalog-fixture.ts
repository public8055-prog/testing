import type { Db } from "mongodb";
/** Explicit synthetic catalogue data; tests never depend on operator data or demo seeds. */
export async function seedTestCategory(db:Db){
  await db.collection<{_id:string;slug:string;payload:Record<string,unknown>}>("categories").updateOne({slug:"housekeeping"},{$setOnInsert:{_id:"housekeeping",slug:"housekeeping",payload:{slug:"housekeeping",name:"Housekeeping",tagline:"QA household services",icon:"Sparkles",image:"",color:"teal",servicesCount:0,active:true}}},{upsert:true});
}
