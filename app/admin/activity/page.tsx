import { notFound } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { WorkspaceShell, PageHeading } from "@/components/platform/shell";
import { AdminActivity } from "@/components/platform/admin-activity";
export const dynamic="force-dynamic";
export default async function ActivityPage(){const user=await getCurrentUser();if(!user||!isAdminRole(user.role))notFound();return <WorkspaceShell name={user.name} admin><PageHeading eyebrow="Platform oversight" title="Website activity" description="Follow recorded operations across customers, vendors and your catalogue."/><AdminActivity/></WorkspaceShell>;}
