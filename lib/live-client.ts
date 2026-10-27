"use client";
import { refreshSession } from "./session-client";
type Listeners = { onReady: () => void; onUpdate: () => void; onError?: () => void };
export function subscribeToUpdates(listeners: Listeners): () => void {
  let closed = false, transport: WebSocket | EventSource | undefined, timer: ReturnType<typeof setTimeout> | undefined, attempts = 0, fallback = false;
  const stop = () => { if (timer) clearTimeout(timer); timer = undefined; if (transport) { transport.onopen = null; transport.onerror = null; if (transport instanceof WebSocket) transport.onclose = null; transport.close(); transport = undefined; } };
  const retry = () => { if (closed || !navigator.onLine || document.visibilityState !== "visible") return; if (timer) clearTimeout(timer); timer = setTimeout(() => { void refreshSession().catch(() => undefined).finally(connect); }, Math.min(15000, 500 * 2 ** Math.min(attempts++, 5))); };
  const connect = () => {
    stop(); if (closed || !navigator.onLine || document.visibilityState !== "visible") return;
    if (fallback) {
      const source = new EventSource("/api/updates/stream"); transport = source;
      source.addEventListener("ready", () => { attempts = 0; listeners.onReady(); }); source.addEventListener("update", listeners.onUpdate);
      source.onerror = () => { listeners.onError?.(); source.close(); retry(); }; return;
    }
    const url = new URL("/api/live", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url); transport = socket; let opened = false;
    socket.onopen = () => { opened = true; attempts = 0; };
    socket.onmessage = event => { try { const message = JSON.parse(String(event.data)); if (message.type === "ready") listeners.onReady(); else if (message.type === "update") listeners.onUpdate(); } catch { listeners.onError?.(); } };
    socket.onerror = () => listeners.onError?.();
    socket.onclose = event => { if (!opened && event.code !== 1008) fallback = true; retry(); };
  };
  const pause = () => stop(), resume = () => { fallback = false; connect(); };
  const visibility = () => { if (document.visibilityState === "visible") resume(); else pause(); };
  window.addEventListener("offline", pause); window.addEventListener("online", resume); document.addEventListener("visibilitychange", visibility); connect();
  return () => { closed = true; stop(); window.removeEventListener("offline", pause); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", visibility); };
}
