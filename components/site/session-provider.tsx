"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AccountUser } from "@/lib/auth";
import { refreshSession, type SessionView } from "@/lib/session-client";
type AccountSession = { user: AccountUser | null; loading: boolean; refresh: () => Promise<void>; catalogOnly:boolean };
const AccountSessionContext = createContext<AccountSession | null>(null);
export function AccountSessionProvider({ children,catalogOnly=false }: { children: React.ReactNode;catalogOnly?:boolean }) {
  const pathname = usePathname(), [user, setUser] = useState<AccountUser | null>(null), [loading, setLoading] = useState(!catalogOnly);
  const identity = useRef<AccountUser | null>(null), pending = useRef<Promise<void> | null>(null), mounted = useRef(true);
  const accept = useCallback((value: SessionView) => { if (!mounted.current) return; identity.current = value.user; setUser(value.user); setLoading(false); }, []);
  const refresh = useCallback(() => {
    if(catalogOnly){accept({user:null,accessExpiresAt:null});return Promise.resolve();}
    if (pending.current) return pending.current;
    pending.current = (async () => {
      try { const response = await fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(10000) }); if(!response.ok)throw new Error("Session temporarily unavailable");const value = await response.json() as SessionView; accept(!value.user && (identity.current || value.requiresRefresh) ? await refreshSession() : value); }
      catch { if (mounted.current) setLoading(false); }
      finally { pending.current = null; }
    })(); return pending.current;
  }, [accept,catalogOnly]);
  useEffect(() => { void refresh(); }, [pathname, refresh]);
  useEffect(() => {
    mounted.current = true;
    const changed = (event: Event) => {if(!catalogOnly)accept((event as CustomEvent<SessionView>).detail);};
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    const authChanged = () => { void refresh(); };
    const interval = setInterval(() => { if (identity.current && document.visibilityState === "visible") void refreshSession().catch(() => undefined); }, 60000);
    window.addEventListener("urbankare:session", changed); window.addEventListener("urbankare:auth-changed", authChanged); window.addEventListener("focus", focus);
    return () => { mounted.current = false; clearInterval(interval); window.removeEventListener("urbankare:session", changed); window.removeEventListener("urbankare:auth-changed", authChanged); window.removeEventListener("focus", focus); };
  }, [accept, refresh,catalogOnly]);
  const value = useMemo(() => ({ user, loading, refresh,catalogOnly }), [user, loading, refresh,catalogOnly]);
  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}
export function useAccountSession(): AccountSession { const value = useContext(AccountSessionContext); if (!value) throw new Error("AccountSessionProvider is missing."); return value; }
