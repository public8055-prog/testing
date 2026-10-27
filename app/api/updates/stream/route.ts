import { requireUser } from "@/lib/auth";
import { apiError, rateLimit } from "@/lib/http";
import { subscribeToUpdates } from "@/lib/updates-hub";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await requireUser(); await rateLimit(`updates-stream:${user.id}`, 30, 60000);
    const encoder = new TextEncoder(); let finish: () => void = () => undefined;
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false, unsubscribe: (() => Promise<void>) | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
        const send = (text: string) => { if (!closed) try { controller.enqueue(encoder.encode(text)); } catch { finish(); } };
        finish = () => { if (closed) return; closed = true; if (heartbeat) clearInterval(heartbeat); if (lifetime) clearTimeout(lifetime); req.signal.removeEventListener("abort", finish); void unsubscribe?.(); try { controller.close(); } catch { /* already cancelled */ } };
        req.signal.addEventListener("abort", finish, { once: true });
        if (req.signal.aborted) { finish(); return; }
        try {
          unsubscribe = await subscribeToUpdates(user.id, () => send("event: update\ndata: {}\n\n"));
          if (closed) { await unsubscribe(); return; }
          send("retry: 5000\nevent: ready\ndata: {}\n\n");
          heartbeat = setInterval(() => send(": heartbeat\n\n"), 25000);
          // Force periodic reauthentication; revoked/expired sessions cannot keep a permanent stream.
          lifetime = setTimeout(finish, 4 * 60000);
        } catch { finish(); }
      }, cancel() { finish(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) { return apiError(error); }
}
