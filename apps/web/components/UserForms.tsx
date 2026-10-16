"use client";
import { useActionState } from "react";
import { createUserAction, resetUserPasswordAction, type UserFormState } from "@/app/actions";
import { OneTimePassword } from "@/components/OneTimePassword";

const ROLE_LABEL: Record<string, string> = { EMPLOYEE: "Mitarbeiter:in", PLANNER: "Planer:in", PDL: "PDL", BETRIEBSRAT: "Betriebsrat", ADMIN: "Admin" };

export function CreateUserForm({ roles }: { roles: string[] }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(createUserAction, {});
  return (
    <div className="space-y-3">
      {state.done && <OneTimePassword done={state.done} />}
      <form action={action} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Neue Person anlegen">
        <label className="text-xs font-medium lg:col-span-2">Name<input name="name" required maxLength={100} defaultValue={state.values?.name} className="input mt-1" /></label>
        <label className="text-xs font-medium lg:col-span-2">E-Mail<input name="email" type="email" required defaultValue={state.values?.email} className="input mt-1" /></label>
        <label className="text-xs font-medium">Rolle
          <select name="role" className="input mt-1" defaultValue={state.values?.role ?? "EMPLOYEE"}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label className="text-xs font-medium">Urlaubstage {new Date().getUTCFullYear()}<input name="entitlement" inputMode="decimal" placeholder="z. B. 30" defaultValue={state.values?.entitlement} className="input mt-1" /></label>
        <label className="text-xs font-medium sm:col-span-2 lg:col-span-3">Passwort <span className="font-normal text-slate-500">(leer = wird erzeugt und einmalig angezeigt)</span><input name="password" type="text" autoComplete="off" minLength={12} className="input mt-1" /></label>
        <div className="flex items-end sm:col-span-2 lg:col-span-3"><button className="btn w-full sm:w-auto" disabled={pending}>{pending ? "Anlegen …" : "Person anlegen"}</button></div>
        {state.error && <p role="alert" className="text-sm text-rose-600 sm:col-span-2 lg:col-span-6">{state.error}</p>}
      </form>
    </div>
  );
}

export function ResetPasswordForm({ userId, name, email }: { userId: string; name: string; email: string }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(resetUserPasswordAction.bind(null, userId), {});
  return (
    <div className="space-y-2">
      <form action={action} aria-label={`Passwort zurücksetzen ${name}`}>
        <input type="hidden" name="name" value={name} /><input type="hidden" name="email" value={email} />
        <button className="btn-ghost !py-1" disabled={pending}>{pending ? "Setze …" : "Neues Passwort erzeugen"}</button>
      </form>
      {state.error && <p role="alert" className="text-xs text-rose-600">{state.error}</p>}
      {state.done && <OneTimePassword done={state.done} />}
    </div>
  );
}
