"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-medium">E-Mail<input name="email" type="email" required autoComplete="username" className="input mt-1" /></label>
      <label className="block text-sm font-medium">Passwort<input name="password" type="password" required autoComplete="current-password" className="input mt-1" /></label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Anmelden …" : "Anmelden"}</button>
    </form>
  );
}
