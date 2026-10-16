"use client";
import { useEffect } from "react";
import { pushSupported, syncHere } from "@/lib/browserPush";

/**
 * Runs once per page load for signed-in people: if this browser has push switched on, it is (re-)registered for the person
 * signed in now. That covers shared PCs where a session ended without pressing "Abmelden", and re-activates push after the
 * server ended someone's subscriptions (password change, etc.). Renders nothing.
 */
export function PushSync({ publicKey }: { publicKey: string }) {
  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    void syncHere(publicKey).catch(() => {});
  }, [publicKey]);
  return null;
}
