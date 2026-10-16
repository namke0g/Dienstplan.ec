import * as SecureStore from "expo-secure-store";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN_KEY = "dienstplan.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** thrown when the server cannot be reached at all (offline, DNS, timeout) */
export class NetworkError extends Error {}

let memToken: string | null = null;
export const getToken = async () => (memToken ??= await SecureStore.getItemAsync(TOKEN_KEY));
export const setToken = async (t: string | null) => {
  memToken = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t); else await SecureStore.deleteItemAsync(TOKEN_KEY);
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = init.auth === false ? null : await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/mobile${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new NetworkError("Keine Verbindung zum Server");
  }
  if (res.status === 401 && init.auth !== false) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}
