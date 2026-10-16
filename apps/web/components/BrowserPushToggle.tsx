"use client";
import { useEffect, useState } from "react";
import { base64UrlToBytes, currentSubscription, pushSupported, registerHere, syncOnce, unsubscribeHere } from "@/lib/browserPush";

type State = "checking" | "unsupported" | "off" | "on" | "denied" | "busy" | "failed";

/** Turns browser notifications on or off for this browser. iPhone/iPad: only works after "Zum Home-Bildschirm". */
export function BrowserPushToggle({ publicKey, userId }: { publicKey: string; userId: string }) {
  const [state, setState] = useState<State>("checking");
  useEffect(() => {
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    // "on" only if this browser's subscription is valid and registered for the person signed in now
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(() => syncOnce(publicKey, false, userId))
      .then((on) => setState(on ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, [publicKey, userId]);

  async function enable() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") return setState("denied");
      if (permission !== "granted") return setState("off"); // prompt closed without a choice: just offer it again
      const reg = await navigator.serviceWorker.ready;
      // a leftover subscription (e.g. made with an old server key) would make subscribe() fail, so start clean
      await (await currentSubscription())?.unsubscribe().catch(() => {});
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      if (!(await registerHere(sub))) { await sub.unsubscribe(); throw new Error("register failed"); }
      setState("on");
    } catch { setState("failed"); }
  }
  async function disable() { setState("busy"); await unsubscribeHere(); setState("off"); }

  const text: Record<State, string> = {
    checking: "Prüfe Browser …",
    unsupported: "Dieser Browser kann keine Push-Mitteilungen empfangen. Auf iPhone/iPad: Seite zuerst über „Teilen → Zum Home-Bildschirm“ hinzufügen und von dort öffnen.",
    off: "Mitteilungen auch in diesem Browser erhalten (z. B. am Arbeitsplatz-PC). Der Text bleibt allgemein, Details siehst du nach der Anmeldung.",
    on: "Browser-Mitteilungen sind in diesem Browser für dich aktiv. Meldest du dich ab, meldet sich hier jemand anderes an oder änderst du dein Passwort, enden sie für dich in diesem Browser.",
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
