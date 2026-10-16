import { cancelLeave, LeaveError, requestLeaveCancellation, withdrawLeaveCancellation } from "@dienstplan/db";
import { deliverSoon } from "@/lib/deliver";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  try {
    await cancelLeave((await params).id, me.id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof LeaveError) return json({ error: e.message }, 400);
    throw e;
  }
}

/** Approved leave: `{ action: "return", reason }` asks to give it back; `{ action: "keep" }` takes that request back. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  const id = (await params).id;
  try {
    if (b.action === "return") { await requestLeaveCancellation(id, me.id, String(b.reason ?? "")); deliverSoon(); }
    else if (b.action === "keep") await withdrawLeaveCancellation(id, me.id);
    else return json({ error: "Unbekannte Aktion" }, 400);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof LeaveError) return json({ error: e.message }, 400);
    throw e;
  }
}
