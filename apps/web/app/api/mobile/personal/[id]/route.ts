import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const { count } = await prisma.personalEntry.deleteMany({ where: { id: (await params).id, userId: me.id } });
  return json({ deleted: count });
}
