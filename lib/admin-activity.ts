import type { Document } from "mongodb";
import { z } from "zod";
import { getMongoDb } from "./mongo";
import { requirePersistedAdmin, type AdminActor } from "./admin-access";
import { HttpError } from "./http";
const sources = [
  { collection: "platform_audit", kind: "administration", action: "$action", actor: "$actor_id", target: "$target_id", href: "/admin/audit-logs" },
  { collection: "bookings", kind: "bookings", action: { $literal: "Service booking created" }, actor: "$user_id", target: "$id", href: "/admin/bookings" },
  { collection: "marketplace_bookings", kind: "bookings", action: { $literal: "Vendor booking created" }, actor: "$customer_id", target: "$id", href: "/admin/bookings" },
  { collection: "marketplace_events", kind: "bookings", action: { $literal: "Vendor booking updated" }, actor: "$actor_id", target: "$booking_id", href: "/admin/bookings" },
  { collection: "queue_events", kind: "queue", action: "$action", actor: "$actor_id", target: "$token_id", href: "/admin/tokens" },
  { collection: "payment_events", kind: "payments", action: { $literal: "Payment event received" }, actor: { $literal: null }, target: "$booking_id", href: "/admin/payments" },
  { collection: "payment_refunds", kind: "payments", action: { $literal: "Refund requested" }, actor: "$actor_id", target: "$booking_id", href: "/admin/payments" },
  { collection: "cash_receipts", kind: "payments", action: { $literal: "Cash receipt recorded" }, actor: "$actor_id", target: "$booking_id", href: "/admin/payments" },
  { collection: "auth_events", kind: "accounts", action: "$event", actor: "$user_id", target: "$user_id", href: "/admin/users" },
  { collection: "contact_requests", kind: "support", action: { $literal: "Contact received" }, actor: { $literal: null }, target: "$reference", href: "/admin/contact" },
  { collection: "platform_complaints", kind: "support", action: { $literal: "Support ticket created" }, actor: "$user_id", target: "$id", href: "/admin/complaints" },
  { collection: "notification_campaigns", kind: "notifications", action: { $literal: "Announcement created" }, actor: "$actor_id", target: "$_id", href: "/admin/notifications" },
];
export type ActivityRow = { id: string; kind: string; action: string; actorId: string; actorName: string; target: string; status: string; createdAt: string; href: string };
export async function adminActivity(actor: AdminActor, input: unknown) {
  await requirePersistedAdmin(actor);
  const parsed=z.object({kind:z.enum(["all","administration","bookings","queue","payments","accounts","support","notifications"]).default("all"),q:z.string().trim().max(100).default(""),page:z.coerce.number().int().min(1).max(10000).default(1),from:z.iso.date().optional(),to:z.iso.date().optional()}).safeParse(input);
  if(!parsed.success)throw new HttpError(400,"Check activity filters.");const p=parsed.data;
  if(p.from&&p.to&&p.from>p.to)throw new HttpError(400,"Start date must not follow end date.");
  const selected=sources.filter(s=>p.kind==="all"||s.kind===p.kind),db=await getMongoDb();
  const stages=(s:typeof sources[number]):Document[]=>{
    const date:Record<string,string>={};if(p.from)date.$gte=`${p.from}T00:00:00.000Z`;if(p.to)date.$lt=new Date(Date.parse(p.to)+86400000).toISOString();
    const pipeline:Document[]=[{$match:Object.keys(date).length?{created_at:date}:{created_at:{$type:"string"}}},{$project:{_id:0,id:{$concat:[s.collection,":",{$toString:"$_id"}]},kind:{$literal:s.kind},action:s.action,actorId:{$ifNull:[s.actor,""]},target:{$ifNull:[s.target,""]},status:{$ifNull:["$status",""]},createdAt:"$created_at",href:{$literal:s.href}}}];
    if(p.q){const regex=p.q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");pipeline.push({$match:{$or:["action","actorId","target","status"].map(key=>({[key]:{$regex:regex,$options:"i"}}))}});}return pipeline;
  };
  const pipeline:Document[]=[...stages(selected[0]),...selected.slice(1).map(s=>({$unionWith:{coll:s.collection,pipeline:stages(s)}})),{$sort:{createdAt:-1,id:-1}},{$facet:{count:[{$count:"total"}],rows:[{$skip:(p.page-1)*30},{$limit:30}]}}];
  const [result]=await db.collection(selected[0].collection).aggregate<{count:{total:number}[];rows:Omit<ActivityRow,"actorName">[]}>(pipeline,{maxTimeMS:10000}).toArray();
  const names=await db.collection("users").find({id:{$in:result.rows.map(r=>r.actorId).filter(Boolean)}},{projection:{_id:0,id:1,name:1}}).toArray();
  return{rows:result.rows.map(r=>({...r,actorName:String(names.find(n=>n.id===r.actorId)?.name|| (r.actorId?"Recorded account":"System / gateway"))})),total:result.count[0]?.total||0,page:p.page,pageSize:30};
}
export async function ensureActivityIndexes(){const db=await getMongoDb();await Promise.all(sources.map(s=>db.collection(s.collection).createIndex({created_at:-1})));}
