import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { mongoCollection } from "@/lib/mongo";
import { WorkspaceShell } from "@/components/platform/shell";
import { NotificationComposer } from "@/components/operations/notifications";
import { ADMIN_ROLES,isAdminRole } from "@/lib/roles";
export const dynamic = "force-dynamic";
export default async function NotificationAdmin() {
  const user = await getCurrentUser(); if (!user||!isAdminRole(user.role)) notFound();
  const customers = await (await mongoCollection<{ id: string; name: string; email: string; role: string }>("users")).find({ role: { $nin:[...ADMIN_ROLES] } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).sort({ name: 1 }).limit(300).toArray();
  const catalog=await(await mongoCollection("services")).find({archived:{$ne:1}},{projection:{slug:1,payload:1}}).sort({slug:1}).toArray();
  const providers=await(await mongoCollection("marketplace_providers")).find({active:1},{projection:{id:1,display_name:1}}).sort({display_name:1}).toArray();
  return <WorkspaceShell name={user.name} admin><NotificationComposer customers={customers.map(c => ({ id: c.id, name: c.name, email: c.email }))} services={[...catalog.map(service=>({id:service.slug,title:service.payload?.title||service.slug})),...providers.map(provider=>({id:`provider:${provider.id}`,title:`Professional · ${provider.display_name}`}))]}/></WorkspaceShell>;
}
