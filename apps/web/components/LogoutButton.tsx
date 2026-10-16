"use client";
import { useRef } from "react";
import { logoutAction } from "@/app/actions";
import { unsubscribeHere } from "@/lib/browserPush";

/** Logs out; first removes this browser's push subscription so a shared computer does not keep getting this person's notifications. */
export function LogoutButton() {
  const form = useRef<HTMLFormElement>(null);
  const done = useRef(false);
  return (
    <form ref={form} action={logoutAction} onSubmit={async (e) => {
      if (done.current) return;
      e.preventDefault();
      await unsubscribeHere();
      done.current = true;
      form.current?.requestSubmit();
    }}>
      <button className="btn-ghost !py-1.5">Abmelden</button>
    </form>
  );
}
