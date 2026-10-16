import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const items = await prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return json({
    unread: items.filter((n) => !n.readAt).length,
    items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, shortNotice: n.shortNotice, createdAt: n.createdAt, read: !!n.readAt })),
  });
}
