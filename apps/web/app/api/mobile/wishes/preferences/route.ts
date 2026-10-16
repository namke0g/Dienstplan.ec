import { ForbiddenError, setPreference, WishError } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

const ids = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").slice(0, 20) : []);

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { prefer?: unknown; avoid?: unknown; note?: string };
  try {
    await setPreference(me.id, { prefer: ids(b.prefer), avoid: ids(b.avoid), note: typeof b.note === "string" ? b.note : undefined });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof WishError || e instanceof ForbiddenError) return json({ error: e.message }, 400);
    throw e;
  }
}
