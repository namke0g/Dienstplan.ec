"use client";
import { useState } from "react";
import type { UserFormState } from "@/app/actions";

/** Shows a generated password once, right after it was created. It is not stored or shown again. */
export function OneTimePassword({ done, onClose }: { done: NonNullable<UserFormState["done"]>; onClose?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="card space-y-2 border-emerald-300 text-sm">
      <p>{done.what === "created" ? <>Konto für <b>{done.name}</b> ({done.email}) angelegt.</> : <>Neues Passwort für <b>{done.name}</b> ({done.email}) gesetzt; alle bisherigen Anmeldungen wurden beendet.</>}</p>
      {done.password ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code aria-label="Einmaliges Passwort" className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-base tracking-wide dark:bg-slate-800">{done.password}</code>
            <button type="button" className="btn-ghost !py-1" onClick={async () => { try { await navigator.clipboard.writeText(done.password!); setCopied(true); } catch {} }}>{copied ? "Kopiert ✓" : "Kopieren"}</button>
          </div>
          <p className="text-xs text-amber-700">Dieses Passwort wird nur jetzt angezeigt. Gib es persönlich weiter; die Person sollte es unter „Mein Konto“ sofort ändern.</p>
        </>
      ) : <p className="text-xs text-slate-500">Das von dir festgelegte Passwort wird aus Sicherheitsgründen nicht angezeigt.</p>}
      {onClose && <button type="button" className="btn-ghost !py-1" onClick={onClose}>Schließen</button>}
    </div>
  );
}
