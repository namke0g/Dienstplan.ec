"use client";
import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";

export function PasswordForm() {
  const [error, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="card max-w-md space-y-3">
      <label className="block text-sm font-medium">Aktuelles Passwort<input name="current" type="password" required autoComplete="current-password" className="input mt-1" /></label>
      <label className="block text-sm font-medium">Neues Passwort <span className="font-normal text-slate-500">(mindestens 12 Zeichen)</span><input name="next" type="password" required minLength={12} autoComplete="new-password" className="input mt-1" /></label>
      <label className="block text-sm font-medium">Neues Passwort wiederholen<input name="repeat" type="password" required minLength={12} autoComplete="new-password" className="input mt-1" /></label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Speichern …" : "Passwort ändern"}</button>
    </form>
  );
}
