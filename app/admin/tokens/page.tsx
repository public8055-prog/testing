import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listTrackedServices } from "@/lib/service-operations";
import { WorkspaceShell } from "@/components/platform/shell";
import { TrackingWorkspace } from "@/components/operations/tracking";
import { isAdminRole } from "@/lib/roles";
export const dynamic = "force-dynamic";
export default async function TokenAdmin({ searchParams }: { searchParams: Promise<{ token?: string;tokenId?:string }> }) {
  const user = await getCurrentUser(); if (!user||!isAdminRole(user.role)) notFound();
  const { token,tokenId } = await searchParams;
  return <WorkspaceShell name={user.name} admin><TrackingWorkspace key={tokenId||token || "all"} admin initial={await listTrackedServices(user, { admin: true, token,tokenId })} initialToken={token} initialTokenId={tokenId}/></WorkspaceShell>;
}
