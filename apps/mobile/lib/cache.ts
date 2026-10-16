import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { NetworkError } from "./api";

const PREFIX = "dienstplan.cache.";
interface Entry<T> { at: number; data: T }
let generation = 0; // bumped on logout: answers to requests started before must not be shown or written back

export const clearCache = async () => {
  generation++;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  await AsyncStorage.removeMany(keys);
};

/**
 * Stale-while-revalidate with a persistent cache: shows the last known data immediately (also with no
 * connection), then refreshes. `offlineSince` is set when the server could not be reached.
 */
export function useRemote<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const latest = useRef(0); // only the newest request of this screen may set data (a slow answer for the previous month must not win)

  const refresh = useCallback(async () => {
    const mine = ++latest.current, gen = generation;
    const current = () => mine === latest.current && gen === generation;
    setLoading(true);
    try {
      const fresh = await fetchRef.current();
      if (!current()) return;
      setData(fresh); setCachedAt(Date.now()); setOffline(false); setError(null);
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data: fresh } satisfies Entry<T>));
    } catch (e) {
      if (!current()) return;
      if (e instanceof NetworkError) setOffline(true); else setError((e as Error).message);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    setData(null); setCachedAt(null);
    (async () => {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      if (raw && alive) { const e = JSON.parse(raw) as Entry<T>; setData(e.data); setCachedAt(e.at); }
      if (alive) await refresh();
    })();
    return () => { alive = false; };
  }, [key, refresh]);

  return { data, cachedAt, offline, error, loading, refresh };
}
