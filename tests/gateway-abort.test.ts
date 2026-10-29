import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { createGateway } from "../scripts/gateway.mjs";

test("a TCP reset during asynchronous live authorization closes that connection and keeps the gateway serving", { timeout: 15000 }, async () => {
  const previousOrigin = process.env.APP_URL;
  const upstreamSockets = new Set<net.Socket>();
  let entered!: () => void;
  const authorizing = new Promise<void>(resolve => { entered = resolve; });
  const upstream = http.createServer((req, res) => {
    if (req.url === "/api/updates/stream") { entered(); return; }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("still serving");
  });
  upstream.on("connection", socket => { upstreamSockets.add(socket); socket.on("error", () => socket.destroy()); socket.on("close", () => upstreamSockets.delete(socket)); });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const upstreamPort = (upstream.address() as net.AddressInfo).port;
  const reservation = net.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  process.env.APP_URL = `http://127.0.0.1:${port}`;
  let closeGateway: (() => Promise<void>) | undefined;
  let client: net.Socket | undefined;
  try {
    closeGateway = await createGateway({ port, hostname: "127.0.0.1", upstreamPort });
    client = net.connect({ host: "127.0.0.1", port }); client.on("error", () => undefined); await once(client, "connect");
    client.write(`GET /api/live HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${process.env.APP_URL}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    await authorizing;
    client.resetAndDestroy(); await once(client, "close");
    const response = await fetch(`${process.env.APP_URL}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); assert.equal(await response.text(), "still serving");
  } finally {
    client?.destroy(); await closeGateway?.();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    if (previousOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousOrigin;
  }
});
