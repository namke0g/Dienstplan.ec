import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { NetworkError } from "./api";

const PREFIX = "dienstplan.cache.";
interface Entry<T> { at: number; data: T }

export const clearCache = async () => {
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await fetchRef.current();
      setData(fresh); setCachedAt(Date.now()); setOffline(false); setError(null);
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data: fresh } satisfies Entry<T>));
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true); else setError((e as Error).message);
    } finally {
      setLoading(false);
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
