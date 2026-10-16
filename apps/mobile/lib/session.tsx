import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken, setUnauthorizedHandler, NetworkError } from "./api";
import { clearCache } from "./cache";
import { registerForPush, unregisterPush } from "./push";
import type { User } from "./types";

interface Session { user: User | null; ready: boolean; login(email: string, password: string): Promise<void>; logout(): Promise<void>; setUser(u: User): void }
const Ctx = createContext<Session | null>(null);
export const useSession = () => { const c = useContext(Ctx); if (!c) throw new Error("no session"); return c; };

const USER_KEY = "dienstplan.user";
const PUSH_KEY = "dienstplan.pushToken";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const setUser = useCallback((u: User) => { setUserState(u); AsyncStorage.setItem(USER_KEY, JSON.stringify(u)); }, []);

  const clear = useCallback(async () => {
    await setToken(null);
    await AsyncStorage.removeMany([USER_KEY, PUSH_KEY]);
    await clearCache(); // never show one person's plan to the next person on this phone
    setUserState(null);
  }, []);

  const logout = useCallback(async () => {
    await unregisterPush(await AsyncStorage.getItem(PUSH_KEY)); // stop pushes to this phone while still authenticated
    await clear();
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(() => { void clear(); });
    (async () => {
      const token = await getToken();
      const cached = await AsyncStorage.getItem(USER_KEY);
      if (token && cached) {
        setUserState(JSON.parse(cached) as User); // usable offline right away
        try { setUser(await api<User>("/me")); } catch (e) { if (!(e instanceof NetworkError)) { /* 401 handled by handler */ } }
      }
      setReady(true);
    })();
    return () => setUnauthorizedHandler(null);
  }, [clear, setUser]);

  useEffect(() => {
    if (!user) return;
    registerForPush().then(async (t) => { if (t) await AsyncStorage.setItem(PUSH_KEY, t); }).catch((e) => console.warn("push registration failed", e));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>("/login", { body: { email, password }, auth: false });
    await clearCache();
    await setToken(r.token);
    setUser(r.user);
  }, [setUser]);

  const value = useMemo(() => ({ user, ready, login, logout, setUser }), [user, ready, login, logout, setUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
