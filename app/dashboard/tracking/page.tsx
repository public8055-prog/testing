import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listTrackedServices } from "@/lib/service-operations";
import { WorkspaceShell } from "@/components/platform/shell";
import { TrackingWorkspace } from "@/components/operations/tracking";
export const dynamic = "force-dynamic";
export default async function TrackingPage({ searchParams }: { searchParams: Promise<{ token?: string;tokenId?:string }> }) {
  const user = await getCurrentUser(); if (!user) redirect("/login?next=%2Fdashboard%2Ftracking");
  const { token,tokenId } = await searchParams;
  return <WorkspaceShell name={user.name}><TrackingWorkspace key={tokenId||token || "all"} initial={await listTrackedServices(user, { token,tokenId })} initialToken={token} initialTokenId={tokenId}/></WorkspaceShell>;
}
