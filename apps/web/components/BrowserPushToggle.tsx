"use client";
import { useEffect, useState } from "react";
import { base64UrlToBytes, currentSubscription, pushSupported, unsubscribeHere } from "@/lib/browserPush";

type State = "checking" | "unsupported" | "off" | "on" | "denied" | "busy" | "failed";

/** Turns browser notifications on or off for this browser. iPhone/iPad: only works after "Zum Home-Bildschirm". */
export function BrowserPushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  useEffect(() => {
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(() => currentSubscription())
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const res = await fetch("/api/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) { await sub.unsubscribe(); throw new Error(String(res.status)); }
      setState("on");
    } catch { setState("failed"); }
  }
  async function disable() { setState("busy"); await unsubscribeHere(); setState("off"); }

  const text: Record<State, string> = {
    checking: "Prüfe Browser …",
    unsupported: "Dieser Browser kann keine Push-Mitteilungen empfangen. Auf iPhone/iPad: Seite zuerst über „Teilen → Zum Home-Bildschirm“ hinzufügen und von dort öffnen.",
    off: "Mitteilungen auch in diesem Browser erhalten (z. B. am Arbeitsplatz-PC). Der Text bleibt allgemein, Details siehst du nach der Anmeldung.",
    on: "Browser-Mitteilungen sind auf diesem Gerät aktiv. Beim Abmelden werden sie hier automatisch ausgeschaltet.",
    denied: "Mitteilungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen des Browsers.",
    busy: "Einen Moment …",
    failed: "Das hat nicht geklappt. Bitte später erneut versuchen.",
  };
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 text-sm" aria-live="polite">
      <span className="max-w-prose"><b>Browser-Mitteilungen</b><br /><span className="text-slate-500">{text[state]}</span></span>
      {state === "on" ? <button type="button" className="btn-ghost" onClick={disable}>In diesem Browser ausschalten</button>
        : (state === "off" || state === "failed") && <button type="button" className="btn" onClick={enable}>In diesem Browser einschalten</button>}
    </div>
  );
}
