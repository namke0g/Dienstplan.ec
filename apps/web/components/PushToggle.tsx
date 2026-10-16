"use client";
import { useState, useTransition } from "react";
import { setPushEnabledAction } from "@/app/actions";

export function PushToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();
  return (
    <label className="card flex items-center justify-between gap-3 text-sm">
      <span><b>Push-Mitteilungen auf dem Handy</b><br /><span className="text-slate-500">Gilt für die Dienstplan-App (iOS &amp; Android). Mitteilungen hier im Portal bleiben immer erhalten.</span></span>
      <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => { setOn(e.target.checked); start(() => setPushEnabledAction(e.target.checked)); }} />
    </label>
  );
}
