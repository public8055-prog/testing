const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The standalone launcher sets this only on its private loopback Next child.
 * Request/forwarded headers never decide the public security origin. */
export function publicRequestUrl(requestUrl: string) {
  const configured = process.env.INTERNAL_GATEWAY_ORIGIN;
  if (!configured) return requestUrl;
  const origin = new URL(configured), request = new URL(requestUrl);
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== configured || origin.username || origin.password) throw new Error("Invalid internal gateway origin.");
  origin.pathname = request.pathname; origin.search = request.search;
  return origin.href;
}

/** Keep deployed origins strict, but let a local preview use its actual port. */
export function isAllowedRequestOrigin(requestUrl: string, origin: string | null, configuredUrl?: string) {
  if (!origin) return true;
  try {
    const request = new URL(requestUrl);
    const supplied = new URL(origin);
    const configured = configuredUrl ? new URL(configuredUrl) : request;
    if (origin !== supplied.origin) return false;

    if (loopbackHosts.has(configured.hostname) && loopbackHosts.has(request.hostname)) {
      // Next can normalize 127.0.0.1 to localhost in Request.url. Ports and
      // protocols still have to match; external origins are never accepted.
      return loopbackHosts.has(supplied.hostname)
        && supplied.protocol === request.protocol
        && supplied.port === request.port;
    }
    return supplied.origin === configured.origin;
  } catch {
    return false;
  }
}
