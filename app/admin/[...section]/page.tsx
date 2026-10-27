import { isAdminRole } from "@/lib/roles";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { adminData } from "@/lib/platform";
import { AdminWorkspace } from "@/components/platform/admin";
import { WorkspaceShell } from "@/components/platform/shell";
export const dynamic="force-dynamic";
export default async function AdminSection({params}:{params:Promise<{section:string[]}>}){const {section}=await params;const key=section[0];if(section.length!==1||!["dashboard","users","providers","customers","businesses","services","categories","bookings","attendance","reviews","complaints","payments","pricing","content","reports","settings","banners","audit-logs"].includes(key))notFound();const user=await getCurrentUser();if(!user||!isAdminRole(user.role))notFound();const data=await adminData(user);return <WorkspaceShell name={user.name} admin><AdminWorkspace data={data} section={key} actor={{id:user.id,role:user.role}}/></WorkspaceShell>;}
