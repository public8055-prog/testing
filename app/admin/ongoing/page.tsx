import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { WorkspaceShell } from "@/components/platform/shell";
import { ServiceQueueBoard } from "@/components/operations/queue";
export const dynamic="force-dynamic";
export default async function OngoingServices(){const user=await getCurrentUser();if(!user||!isAdminRole(user.role))notFound();return <WorkspaceShell name={user.name} admin><ServiceQueueBoard status="in_service"/></WorkspaceShell>;}
