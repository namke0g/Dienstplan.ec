import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  await prisma.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });
  return json({ ok: true });
}
