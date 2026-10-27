import { isAdminRole } from "@/lib/roles";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminOperations } from "@/components/admin/operations";
import { WorkspaceShell } from "@/components/platform/shell";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) notFound();
  return <WorkspaceShell admin name={user.name}><AdminOperations name={user.name} /></WorkspaceShell>;
}
