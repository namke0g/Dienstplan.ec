import { cancelLeave, LeaveError } from "@dienstplan/db";
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
