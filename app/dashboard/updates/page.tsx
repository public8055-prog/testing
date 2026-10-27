import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listNotifications } from "@/lib/service-operations";
import { WorkspaceShell } from "@/components/platform/shell";
import { NotificationsWorkspace } from "@/components/operations/notifications";
export const dynamic = "force-dynamic";
export default async function UpdatesPage() {
  const user = await getCurrentUser(); if (!user) redirect("/login?next=%2Fdashboard%2Fupdates");
  return <WorkspaceShell name={user.name}><NotificationsWorkspace initial={await listNotifications(user.id)}/></WorkspaceShell>;
}
