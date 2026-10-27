"use client";
import type { AccountUser } from "./auth-types";
export type SessionView = { user: AccountUser | null; accessExpiresAt?: string | number | null; requiresRefresh?: boolean };
let pending: Promise<SessionView> | undefined;
async function refreshUnderLock(): Promise<SessionView> {
  const current = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!current.ok) throw new Error("Your session could not be checked. Please retry.");
  const existing = await current.json() as SessionView;
  const expiry = existing?.accessExpiresAt;
  const expiresAt = typeof expiry === "number" ? expiry : expiry ? Date.parse(expiry) : Date.now() + 120000;
  if (existing?.user && expiresAt > Date.now() + 60000) return existing;
  const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(10000) });
  if (!response.ok) { if (response.status === 401) return { user: null }; throw new Error("Your session could not be refreshed. Please retry."); }
  return response.json() as Promise<SessionView>;
}
async function legacyBrowserLock<T>(action: () => Promise<T>): Promise<T> {
  // IndexedDB read/write transactions serialize this lease across tabs without storing credentials.
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("urbankare-session-lock", 1); request.onupgradeneeded = () => request.result.createObjectStore("locks"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Browser session coordination is unavailable.")); });
  const owner = crypto.randomUUID(), deadline = Date.now() + 45000;
  const change = (release = false) => new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction("locks", "readwrite"), store = transaction.objectStore("locks"), read = store.get("refresh"); let acquired = false;
    read.onsuccess = () => { const lease = read.result as { owner: string; until: number } | undefined; if (release) { if (lease?.owner === owner) store.delete("refresh"); } else if (!lease || lease.until < Date.now()) { store.put({ owner, until: Date.now() + 30000 }, "refresh"); acquired = true; } };
    transaction.oncomplete = () => resolve(acquired); transaction.onerror = () => reject(new Error("Browser session coordination is unavailable."));
  });
  try { while (!await change()) { if (Date.now() > deadline) throw new Error("Another tab is refreshing your session. Please retry."); await new Promise(resolve => setTimeout(resolve, 150)); } return await action(); }
  finally { await change(true).catch(() => undefined); database.close(); }
}
export function refreshSession(): Promise<SessionView> {
  if (!pending) pending = (navigator.locks ? navigator.locks.request("urbankare-session-refresh", refreshUnderLock) : legacyBrowserLock(refreshUnderLock)).then(value => { window.dispatchEvent(new CustomEvent("urbankare:session", { detail: value })); return value; }).finally(() => { pending = undefined; });
  return pending;
}
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input instanceof Request ? input : new URL(String(input), location.origin), init);
  const url = new URL(request.url);
  const authenticatedApi = url.origin === location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/") && request.credentials !== "omit";
  if (!authenticatedApi) return fetch(request);
  request.signal.throwIfAborted();
  // Administrative authorization intentionally returns 404. Refresh before those
  // requests, so genuine missing resources remain 404 and are never replayed.
  const administration = url.pathname.startsWith("/api/admin/") || url.pathname === "/api/platform" && request.method === "PATCH" || url.pathname === "/api/notifications" && request.method === "POST";
  if (administration) { await refreshSession(); request.signal.throwIfAborted(); return fetch(request); }
  const retry = request.clone(), response = await fetch(request);
  if (response.status !== 401) return response;
  request.signal.throwIfAborted();
  const session = await refreshSession();
  request.signal.throwIfAborted();
  // Only a rejected authentication check is replayed, once, with the original
  // body and idempotency headers. Network errors and business failures propagate.
  return session.user ? fetch(retry) : response;
}
