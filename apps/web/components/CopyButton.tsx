"use client";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <input readOnly value={text} onFocus={(e) => e.currentTarget.select()} className="input text-xs" aria-label="Kalender-Link" />
      <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch {} }}>
        {done ? "Kopiert ✓" : "Link kopieren"}
      </button>
    </div>
  );
}
