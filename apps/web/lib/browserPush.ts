/** Browser helpers shared by the push toggle and the logout button (client side only). */
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
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

export function base64UrlToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
