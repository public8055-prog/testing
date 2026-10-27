/** The public origin can differ from the port listened on inside a container. */
export function resolvePublicOrigin(configuredUrl, listenPort, { explicitPort = false } = {}) {
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new Error("Choose a valid listening port between 1 and 65535.");
  let url;
  try { url = new URL(configuredUrl || `http://localhost:${listenPort}`); }
  catch { throw new Error("Configure APP_URL as the application's public origin."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Configure APP_URL as the application's public origin.");
  // Only an explicit preview CLI override changes a configured loopback origin.
  // Environment PORT is a listener setting, including Docker host:container maps.
  if (explicitPort && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.port = String(listenPort);
  return url.origin;
}
