import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { BagGroup, Flight } from "@/lib/api/sgs";

const SESSION_KEY = "sgs.session";

type Session = {
  flight: Flight;
  /**
   * Pinned bag group. Optional: in the flight-only flow (introduced when
   * the scan screen learned to render a per-flight group-cards grid) the
   * agent picks only a flight at session-setup and works every group of
   * that flight from a single screen. Legacy pinned-group sessions still
   * work — when set, scan/no-tag/bulk-receive prefer this group; when
   * absent, those screens resolve the group per-bag from the merged
   * flight manifest.
   */
  group?: BagGroup;
  startedAt: string;
};

type SessionContextValue = {
  ready: boolean;
  session: Session | null;
  setSession: (s: Session | null) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) setSessionState(JSON.parse(raw) as Session);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setSession = useCallback(async (s: Session | null) => {
    setSessionState(s);
    if (s) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const value = useMemo(
    () => ({ ready, session, setSession }),
    [ready, session, setSession],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
