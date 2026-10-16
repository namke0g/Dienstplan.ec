import { endSickReport, extendSickReport, ForbiddenError, SickError } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";
import { deliverSoon } from "@/lib/deliver";

/** body: { action: "extend", end } or { action: "end", backOn } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const id = (await params).id;
  const b = (await req.json().catch(() => ({}))) as { action?: string; end?: string; backOn?: string };
  try {
    if (b.action === "extend") await extendSickReport(me.id, id, String(b.end ?? ""));
    else if (b.action === "end") await endSickReport(me.id, id, String(b.backOn ?? ""));
    else return json({ error: "invalid" }, 400);
    deliverSoon();
    return json({ ok: true });
  } catch (e) {
    if (e instanceof SickError || e instanceof ForbiddenError) return json({ error: e.message }, 400);
    throw e;
  }
}
