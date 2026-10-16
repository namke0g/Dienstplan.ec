"use client";
import { useEffect } from "react";
import { pushSupported, syncOnce } from "@/lib/browserPush";

/**
 * Runs once per page load for signed-in people: if this browser has push switched on, it is (re-)registered for the person
 * signed in now. That covers shared PCs where a session ended without pressing "Abmelden", and re-activates push after the
 * server ended someone's subscriptions (password change, etc.). Renders nothing. `fresh` re-syncs even if this page load
 * already did (used right after the person changed their own password, which ends their browser subscriptions).
 */
export function PushSync({ publicKey, userId, fresh = false }: { publicKey: string; userId: string; fresh?: boolean }) {
  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    void syncOnce(publicKey, fresh, userId);
  }, [publicKey, fresh, userId]);
  return null;
}
