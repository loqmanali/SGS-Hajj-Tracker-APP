import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, Platform } from "react-native";

import { sgsApi, setAuthToken } from "@/lib/api/sgs";

const TOKEN_KEY = "sgs.authToken";
const USER_KEY = "sgs.authUser";

type User = { id: string; name: string; role: string };

type AuthContextValue = {
  ready: boolean;
  user: User | null;
  token: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}
async function secureSet(key: string, value: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  return SecureStore.setItemAsync(key, value);
}
async function secureDel(key: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  return SecureStore.deleteItemAsync(key);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          secureGet(TOKEN_KEY),
          secureGet(USER_KEY),
        ]);
        if (t) {
          setToken(t);
          setAuthToken(t);
        }
        if (u) setUser(JSON.parse(u) as User);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await sgsApi.login(username, password);
    setAuthToken(res.token);
    setToken(res.token);
    setUser(res.user);
    await Promise.all([
      secureSet(TOKEN_KEY, res.token),
      secureSet(USER_KEY, JSON.stringify(res.user)),
    ]);
  }, []);

  // Silent refresh attempt when the app returns to the foreground.
  // If the platform exposes a refresh endpoint and the call fails with 401,
  // we sign out so the agent gets a fresh login prompt instead of a dead UI.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active" || !token) return;
      try {
        await sgsApi.flights();
      } catch (err) {
        const code = (err as { status?: number }).status;
        if (code === 401 || code === 403) {
          setAuthToken(null);
          setToken(null);
          setUser(null);
          await Promise.all([secureDel(TOKEN_KEY), secureDel(USER_KEY)]);
        }
      }
    });
    return () => sub.remove();
  }, [token]);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await Promise.all([secureDel(TOKEN_KEY), secureDel(USER_KEY)]);
  }, []);

  const value = useMemo(
    () => ({ ready, user, token, signIn, signOut }),
    [ready, user, token, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
