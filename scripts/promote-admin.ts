import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { getMongoDb,withMongoTransaction,closeMongo } from "../lib/mongo";
import { ensureAuth } from "../lib/auth";
import { revokeUserRefreshFamilies } from "../lib/auth-state";
import { closeRedis } from "../lib/redis";
import { auditAuthEvent } from "../lib/auth-audit";
import { isAccountActive,isSuperAdminRole } from "../lib/roles";
type Row=Document&{_id:string};
for(const file of[".env.production.local",".env.local",".env.production",".env"])if(existsSync(file))process.loadEnvFile(file);
async function main(){const email=process.argv[2]?.trim().toLowerCase();if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Usage: npm run admin:promote -- registered-email@example.com");await ensureAuth();const db=await getMongoDb();const userId=await withMongoTransaction(async session=>{await db.collection<Row>("platform_locks").updateOne({_id:"admin-mutations"},{$inc:{version:1}},{session});const user=await db.collection<Row>("users").findOne({email},{session});if(!isAccountActive(user,await db.collection<Row>("platform_account_status").findOne({user_id:user?.id},{session})))throw new Error("An active registered account is required.");const role=isSuperAdminRole(user!.role)?"SUPER_ADMIN":"ADMIN";await db.collection<Row>("users").updateOne({id:user!.id},{$set:{role},$inc:{auth_version:1}},{session});await db.collection<Row>("sessions").deleteMany({user_id:user!.id},{session});const id=randomUUID();await db.collection<Row>("platform_audit").insertOne({_id:id,id,actor_id:user!.id,action:"administrator.promoted",target_id:user!.id,details:JSON.stringify({method:"protected-cli",role}),created_at:new Date().toISOString()},{session});await auditAuthEvent("administrator.promoted",{userId:String(user!.id)},session);return String(user!.id);});await revokeUserRefreshFamilies(userId).catch(()=>undefined);console.log("Administrator access granted. Sign in again through /login.");}
main().catch(()=>{console.error("Promotion failed. Check the registered account, protected environment and database availability.");process.exitCode=1;}).finally(async()=>{await closeMongo();await closeRedis();});
