import { SessionRefresh } from "@/components/platform/session-refresh";
import { safeRedirectPath } from "@/lib/safe-redirect";
export default async function RefreshPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(next);
  return <SessionRefresh next={destination}/>;
}
