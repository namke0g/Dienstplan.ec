"use client";
import { useState, useTransition } from "react";
import { setPushEnabledAction } from "@/app/actions";

export function PushToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();
  return (
    <label className="card flex items-center justify-between gap-3 text-sm">
      <span><b>Push-Mitteilungen</b><br /><span className="text-slate-500">Hauptschalter für alle deine Geräte: Dienstplan-App (iOS &amp; Android) und Browser. Mitteilungen hier im Portal bleiben immer erhalten.</span></span>
      <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => { setOn(e.target.checked); start(() => setPushEnabledAction(e.target.checked)); }} />
    </label>
  );
}
