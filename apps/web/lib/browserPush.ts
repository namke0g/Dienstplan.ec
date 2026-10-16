/** Browser helpers shared by the push toggle, the background sync and the logout button (client side only). */
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function base64UrlToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True if the subscription was made with the server's current VAPID key (after a key change, old subscriptions are useless). */
export function madeWithKey(sub: PushSubscription, publicKey: string) {
  const key = sub.options?.applicationServerKey;
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = base64UrlToBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Saves this browser's subscription for whoever is signed in now (moves it away from a previous person on a shared PC). */
export async function registerHere(sub: PushSubscription) {
  const res = await fetch("/api/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  return res.ok;
}

/** Removes this browser's subscription on the server and in the browser. Never throws, never takes longer than `maxMs`. */
export async function unsubscribeHere(maxMs = 3000) {
  const work = (async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch("/api/push/register", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), signal: AbortSignal.timeout(maxMs),
    }).catch(() => {});
    await sub.unsubscribe(); // even if the server did not answer: this browser stops receiving
  })().catch(() => {});
  await Promise.race([work, new Promise((ok) => setTimeout(ok, maxMs))]);
}

/**
 * Brings this browser's subscription in line with the signed-in person and the server key. Returns whether push is active here.
 * - subscription made with an old key: dropped (it can never receive anything again)
 * - otherwise: re-registered for the current person (on a shared PC this takes it over from whoever used the browser before)
 */
let pending: { key: string; result: Promise<boolean> } | null = null;

/**
 * syncHere, shared by everything on the page that needs it (one request per page load and person); `fresh` forces a new sync.
 * `who` is the signed-in person: logins switch users without a full page load, and one person's result must not be reused for the next.
 */
export function syncOnce(publicKey: string, fresh = false, who = ""): Promise<boolean> {
  const key = `${publicKey}|${who}`;
  if (!fresh && pending?.key === key) return pending.result;
  pending = { key, result: syncHere(publicKey).catch(() => false) };
  return pending.result;
}

export async function syncHere(publicKey: string): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  if (!madeWithKey(sub, publicKey)) { await sub.unsubscribe().catch(() => {}); return false; }
  if (Notification.permission !== "granted") return false;
  return registerHere(sub).catch(() => false);
}
