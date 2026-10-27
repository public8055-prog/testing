import { getRedis } from "./redis";
import { userChannel } from "./service-operations";
async function makeSubscriber() { const client = (await getRedis()).duplicate(); client.on("error", () => undefined); await client.connect(); return client; }
type Subscriber = Awaited<ReturnType<typeof makeSubscriber>>;
type Hub = { client?: Promise<Subscriber>; queue: Promise<void>; listeners: Map<string, Set<() => void>> };
const globalHub = globalThis as typeof globalThis & { urbanKareUpdatesHub?: Hub };
const state: Hub = (globalHub.urbanKareUpdatesHub ??= { queue: Promise.resolve(), listeners: new Map() });
async function serialized(fn: () => Promise<void>) { const next = state.queue.then(fn); state.queue = next.catch(() => undefined); return next; }
export async function subscribeToUpdates(userId: string, listener: () => void): Promise<() => Promise<void>> {
  const channel = userChannel(userId);
  await serialized(async () => {
    if (!state.client) state.client = makeSubscriber().catch(error => { state.client = undefined; throw error; });
    const client = await state.client;
    let listeners = state.listeners.get(channel);
    if (!listeners) {
      listeners = new Set(); state.listeners.set(channel, listeners);
      try { await client.subscribe(channel, () => { for (const notify of state.listeners.get(channel) || []) notify(); }); }
      catch (error) { state.listeners.delete(channel); throw error; }
    }
    listeners.add(listener);
  });
  return () => serialized(async () => {
    const listeners = state.listeners.get(channel); listeners?.delete(listener);
    if (listeners?.size === 0) { state.listeners.delete(channel); await (await state.client)?.unsubscribe(channel).catch(() => undefined); }
  });
}
export async function closeUpdatesHub() {
  await state.queue;
  const client = await state.client?.catch(() => undefined);
  state.listeners.clear();
  if (client?.isOpen) client.destroy();
  state.client = undefined;
}
