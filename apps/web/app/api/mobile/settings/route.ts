import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function PATCH(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { pushEnabled?: boolean };
  if (typeof b.pushEnabled !== "boolean") return json({ error: "invalid" }, 400);
  await prisma.user.update({ where: { id: me.id }, data: { pushEnabled: b.pushEnabled } });
  return json({ pushEnabled: b.pushEnabled });
}
