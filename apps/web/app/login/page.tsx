import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="card space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Dienstplan</h1>
          <p className="text-sm text-slate-500">Bitte melde dich an.</p>
        </div>
        <LoginForm />
        {process.env.NODE_ENV !== "production" && (
          <p className="text-xs text-slate-500">Demo: planer@demo.de · pdl@demo.de · br@demo.de · anna@demo.de — Passwort demo1234</p>
        )}
      </div>
    </main>
  );
}
