import { applySessionCookies, clearAuthenticationCookies } from "@/lib/auth";
import { refreshRequestSession } from "@/lib/auth-sessions";
import { apiError, assertSameOrigin, HttpError, rateLimit, requestIp } from "@/lib/http";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req); await rateLimit(`refresh-ip:${requestIp(req)}`, 60, 900000);
    const session = await refreshRequestSession(req.headers.get("cookie") || ""); await applySessionCookies(session);
    return Response.json({ user: session.user, accessExpiresAt: session.accessExpiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { if (error instanceof HttpError && error.status === 401) await clearAuthenticationCookies(); return apiError(error); }
}
