"use client";
import { useRef, useState } from "react";
import { logoutAction } from "@/app/actions";
import { unsubscribeHere } from "@/lib/browserPush";

/** Logs out; first removes this browser's push subscription so a shared computer does not keep getting this person's notifications. */
export function LogoutButton() {
  const form = useRef<HTMLFormElement>(null);
  const done = useRef(false);
  const [busy, setBusy] = useState(false);
  return (
    <form ref={form} action={logoutAction} onSubmit={async (e) => {
      if (done.current) return; // second pass: let the real logout go through
      e.preventDefault();
      if (busy) return; // ignore double clicks
      setBusy(true);
      await unsubscribeHere(3000); // bounded: logging out must never hang on push
      done.current = true;
      form.current?.requestSubmit();
    }}>
      <button className="btn-ghost !py-1.5" disabled={busy} aria-busy={busy}>{busy ? "Abmelden …" : "Abmelden"}</button>
    </form>
  );
}
