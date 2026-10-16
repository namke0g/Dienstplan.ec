import { changePassword, AdminError } from "@dienstplan/db";
import { json, mobileUser, signMobileToken, unauthorized } from "@/lib/mobileAuth";
import { clientIp, loginBlockedFor, recordLoginFailure, recordLoginSuccess } from "@/lib/rateLimit";

/** Changes the password; all other sessions and tokens stop working, so the caller gets a fresh token for this device. */
export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  const ip = clientIp(req.headers);
  const wait = loginBlockedFor(ip, me.email);
  if (wait !== null) return Response.json({ error: "Zu viele Fehlversuche. Bitte später erneut versuchen.", retryAfterSeconds: wait }, { status: 429, headers: { "retry-after": String(wait) } });
  try {
    await changePassword(me.id, String(b.current ?? ""), String(b.next ?? ""));
  } catch (e) {
    if (e instanceof AdminError) { if (/aktuelle Passwort/.test(e.message)) recordLoginFailure(ip, me.email); return json({ error: e.message }, 400); }
    throw e;
  }
  recordLoginSuccess(ip, me.email);
  return json({ token: await signMobileToken(me.id) });
}
