import { NextRequest, NextResponse } from "next/server";
import { apiError, rateLimit, requestIp } from "./lib/http";
import { isAllowedRequestOrigin, publicRequestUrl } from "./lib/request-origin";
import { getUserFromCookieHeader, getRefreshUserFromCookieHeader, REFRESH_COOKIE } from "./lib/auth-sessions";
import { isAdminRole } from "./lib/roles";

export async function proxy(request: NextRequest) {
  const publicUrl = new URL(publicRequestUrl(request.url));
  let path = request.nextUrl.pathname;
  try { path = decodeURIComponent(path); } catch { return new NextResponse("Not found", { status: 404 }); }
  const privatePath = /(^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|\.data(?:\/|$)|node_modules(?:\/|$)|artifacts(?:\/|$))|\.(?:sqlite|db|pem|key|log|env)$/i.test(path);
  // A streamed not-found page can carry HTTP 200. Reject configuration probes
  // before rendering, so these paths always have an explicit private-file denial.
  const configurationPath = /^\/(?:package(?:-lock)?\.json|(?:next|eslint)\.config\.[a-z]+|tsconfig(?:\.[a-z-]+)?\.json|docker-compose(?:\.[a-z-]+)?\.ya?ml|Dockerfile|AGENTS\.md|README\.md)(?:\/|$)/i.test(path);
  if (privatePath || configurationPath) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  const api = path.startsWith("/api/"), administration = path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");
  try {
    if (api) {
      await rateLimit(`global-api:${requestIp(request)}`, 100, 60000);
      if (!isAllowedRequestOrigin(publicUrl.href, request.headers.get("origin"), process.env.APP_URL)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
      if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Origin": request.headers.get("origin") || publicUrl.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key", "Vary": "Origin", "Cache-Control": "no-store" } });
    }
    const protectedPage = /^\/(?:dashboard|business|provider|bookings|booking|locations)(?:\/|$)/.test(path);
    if (administration || protectedPage) {
      const user = await getUserFromCookieHeader(request.headers.get("cookie") || "");
      if (administration && (!user || !isAdminRole(user.role))) {
        const expiredAdministrator = !api && !user && request.cookies.has(REFRESH_COOKIE) ? await getRefreshUserFromCookieHeader(request.headers.get("cookie") || "") : null;
        if (expiredAdministrator && isAdminRole(expiredAdministrator.role)) { const next = new URL("/session/refresh", publicUrl); next.searchParams.set("next", path + request.nextUrl.search); return NextResponse.redirect(next); }
        return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (!user && protectedPage) {
        const destination = path + request.nextUrl.search;
        const next = new URL(request.cookies.has(REFRESH_COOKIE) ? "/session/refresh" : "/login", publicUrl);
        next.searchParams.set("next", destination); return NextResponse.redirect(next);
      }
    }
  } catch (error) { return apiError(error); }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const https = process.env.APP_URL?.startsWith("https://") === true;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.razorpay.com${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${publicUrl.protocol === "https:" ? "wss:" : "ws:"}//${publicUrl.host} https://*.razorpay.com https://api.stripe.com${development ? " ws: wss:" : ""}`,
    "frame-src https://*.razorpay.com https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'", "base-uri 'self'", "form-action 'self' https://checkout.stripe.com", "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  const uploadDownload = (request.method === "GET" || request.method === "HEAD") && /^\/api\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
  // The upload handler knows visibility: public image bytes are immutable,
  // private documents stay no-store, and both use a restrictive sandbox CSP.
  // Proxy response headers would override those route-specific decisions.
  if (!uploadDownload) {
    response.headers.set("Content-Security-Policy", policy);
    response.headers.set("Cache-Control", "private, no-store");
  }
  if (https) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"] };
