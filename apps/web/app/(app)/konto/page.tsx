import { vapidConfig, webPushConfigured } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { PushSync } from "@/components/PushSync";
import { PasswordForm } from "@/components/PasswordForm";

export default async function Konto({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const me = await requireUser();
  const { ok } = await searchParams;
  return (
    <>
      <h1 className="text-lg font-semibold">Mein Konto</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">{me.name} · {me.email}</p>
      {/* changing the password ended this person's browser subscriptions everywhere: re-register this browser right away */}
      {ok && webPushConfigured() && <PushSync publicKey={vapidConfig().publicKey} fresh />}
      {ok && <p role="status" className="card max-w-md border-emerald-300 text-sm text-emerald-700">Passwort geändert. Auf allen anderen Geräten musst du dich neu anmelden.</p>}
      <h2 className="font-semibold">Passwort ändern</h2>
      <PasswordForm />
    </>
  );
}
