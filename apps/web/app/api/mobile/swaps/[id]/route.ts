import { acceptSwap, cancelSwap, declineSwap, ForbiddenError, SwapError } from "@dienstplan/db";
import { deliverSoon } from "@/lib/deliver";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

async function run(fn: () => Promise<unknown>) {
  try { await fn(); deliverSoon(); return json({ ok: true }); }
  catch (e) {
    if (e instanceof SwapError) return json({ error: e.message }, 400);
    if (e instanceof ForbiddenError) return json({ error: "forbidden" }, 403);
    throw e;
  }
}

/** body: { action: "accept" | "decline" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const id = (await params).id;
  if (action === "accept") return run(() => acceptSwap(id, me.id));
  if (action === "decline") return run(() => declineSwap(id, me.id));
  return json({ error: "invalid" }, 400);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const id = (await params).id;
  return run(() => cancelSwap(id, me.id));
}
