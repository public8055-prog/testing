import http from "node:http";
import { WebSocketServer } from "ws";
import helmet from "helmet";
import { randomUUID } from "node:crypto";

export function isAllowedWebSocketOrigin(origin, host, configuredUrl) {
  try {
    const configured = new URL(configuredUrl), supplied = new URL(origin || "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"];
    return supplied.origin === origin && (loopback.includes(configured.hostname)
      ? loopback.includes(supplied.hostname) && supplied.host === host && supplied.protocol === configured.protocol
      : supplied.origin === configured.origin);
  } catch { return false; }
}

/** Fronts the standalone Next server and converts its authenticated Redis event stream to WebSocket frames. */
export async function createGateway({ port, hostname, upstreamPort }) {
  const internalOrigin = `http://127.0.0.1:${upstreamPort}`;
  const secureHeaders = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, strictTransportSecurity: process.env.APP_URL?.startsWith("https:") ? { maxAge: 31536000 } : false, referrerPolicy: { policy: "strict-origin-when-cross-origin" } });
  const sockets = new Set(), streams = new Set();
  function forwardingHeaders(req) {
    const headers = { ...req.headers };
    delete headers.connection; delete headers.upgrade; delete headers["proxy-authorization"]; delete headers["x-nonce"];
    headers["x-forwarded-for"] = process.env.TRUST_PROXY === "true" ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim() : req.socket.remoteAddress || "unknown";
    headers["x-forwarded-proto"] = process.env.TRUST_PROXY === "true" && req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    headers["x-request-id"] = randomUUID();
    return headers;
  }
  const server = http.createServer((req, res) => {
    secureHeaders(req, res, () => {
      const request = http.request({ hostname: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method, headers: forwardingHeaders(req) }, upstream => {
        upstream.on("error", () => res.destroy());
        upstream.on("aborted", () => res.destroy());
        if (res.destroyed) { upstream.destroy(); return; }
        res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res);
      });
      request.on("error", () => { if (res.destroyed || res.writableEnded) return; if (res.headersSent) { res.destroy(); return; } res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "2" }); res.end('{"error":"Service is temporarily unavailable."}'); });
      req.on("error", () => request.destroy()); res.on("error", () => request.destroy());
      req.on("aborted", () => request.destroy()); res.on("close", () => request.destroy()); req.pipe(request);
    });
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  server.on("connection", socket => {
    sockets.add(socket);
    // During the asynchronous WebSocket authorization handshake, Node has
    // detached its HTTP parser but ws has not yet installed socket handlers.
    // A client reset in that interval must close only that connection.
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on("upgrade", async (req, socket, head) => {
    const deny = (status = "404 Not Found") => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); };
    if ((req.url || "").split("?")[0] !== "/api/live") return deny();
    const origin = req.headers.origin;
    if (!isAllowedWebSocketOrigin(origin, req.headers.host, process.env.APP_URL || internalOrigin)) return deny("403 Forbidden");
    const abort = new AbortController(); streams.add(abort);
    socket.once("close", () => { abort.abort(); streams.delete(abort); });
    let response;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try { response = await fetch(`${internalOrigin}/api/updates/stream`, { headers: { ...forwardingHeaders(req), host: req.headers.host, cookie: req.headers.cookie || "", origin }, signal: abort.signal }); }
    catch { clearTimeout(timeout); abort.abort(); streams.delete(abort); return deny("503 Service Unavailable"); }
    clearTimeout(timeout);
    if (!response.ok || !response.body) { abort.abort(); streams.delete(abort); return deny(response.status === 429 ? "429 Too Many Requests" : "401 Unauthorized"); }
    if (socket.destroyed) { abort.abort(); streams.delete(abort); return; }
    wsServer.handleUpgrade(req, socket, head, ws => {
      let alive = true;
      const heartbeat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 25000);
      ws.on("pong", () => { alive = true; });
      // Invalid protocol frames are connection failures, never process-level errors.
      ws.on("error", () => { ws.terminate(); });
      // Client frames are never interpreted as commands. Mutations require the authenticated HTTP APIs.
      ws.on("message", () => { ws.close(1008, "This connection receives updates only."); });
      ws.on("close", () => { clearInterval(heartbeat); abort.abort(); streams.delete(abort); });
      void (async () => {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 65536) throw new Error("Invalid upstream event.");
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const event = /^event: (ready|update)$/m.exec(frame)?.[1];
              if (event && ws.readyState === ws.OPEN) { if (ws.bufferedAmount > 65536) return ws.close(1013, "Reconnect to refresh updates."); ws.send(JSON.stringify({ type: event, data: {} })); }
            }
          }
        } catch { /* Disconnects are retried by the client and refresh the durable inbox. */ }
        finally { reader.releaseLock(); clearInterval(heartbeat); if (ws.readyState === ws.OPEN) ws.close(1000, "Refresh session and reconnect."); }
      })();
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, hostname, resolve); });
  return async () => {
    for (const stream of streams) stream.abort();
    for (const ws of wsServer.clients) ws.close(1001, "Server restarting.");
    await new Promise(resolve => { const deadline = setTimeout(() => { for (const ws of wsServer.clients) ws.terminate(); for (const socket of sockets) socket.destroy(); resolve(); }, 10000); deadline.unref(); server.close(() => { clearTimeout(deadline); resolve(); }); });
    wsServer.close();
  };
}
