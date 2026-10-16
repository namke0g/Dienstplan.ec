"use client";
import { useEffect, useState } from "react";

function b64ToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied" | "busy">("busy");
  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.register("/sw.js").then((r) => r.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off")).catch(() => setState("unsupported"));
  }, [publicKey]);

  async function enable() {
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const res = await fetch("/api/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error();
      setState("on");
    } catch { setState("off"); }
  }
  async function disable() {
    setState("busy");
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/register", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "unsupported") return <p className="card text-sm text-slate-500">Push wird in diesem Browser nicht unterstützt. Auf dem iPhone zuerst „Zum Home-Bildschirm“ hinzufügen.</p>;
  return (
    <div className="card flex items-center justify-between gap-3 text-sm">
      <span>{state === "on" ? "Push-Mitteilungen sind auf diesem Gerät aktiv." : state === "denied" ? "Push ist im Browser blockiert. Bitte in den Browser-Einstellungen erlauben." : "Bei Planänderungen und Entscheidungen benachrichtigt werden."}</span>
      {state === "on" ? <button className="btn-ghost" onClick={disable}>Ausschalten</button>
        : state !== "denied" && <button className="btn" disabled={state === "busy"} onClick={enable}>Push aktivieren</button>}
    </div>
  );
}
