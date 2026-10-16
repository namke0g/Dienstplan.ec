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

/** Removes this browser's subscription on the server and in the browser. Never throws. */
export async function unsubscribeHere() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch("/api/push/register", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* logging out must never be blocked by push */ }
}

/**
 * Brings this browser's subscription in line with the signed-in person and the server key. Returns whether push is active here.
 * - subscription made with an old key: dropped (it can never receive anything again)
 * - otherwise: re-registered for the current person (on a shared PC this takes it over from whoever used the browser before)
 */
export async function syncHere(publicKey: string): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  if (!madeWithKey(sub, publicKey)) { await sub.unsubscribe().catch(() => {}); return false; }
  if (Notification.permission !== "granted") return false;
  return registerHere(sub).catch(() => false);
}
