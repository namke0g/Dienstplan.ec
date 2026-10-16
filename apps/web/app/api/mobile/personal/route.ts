import { prisma, toDate, toYmd } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { date?: string; title?: string; note?: string };
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !b.title?.trim()) return json({ error: "invalid" }, 400);
  const e = await prisma.personalEntry.create({ data: { userId: me.id, date: toDate(b.date), title: b.title.trim().slice(0, 120), note: b.note?.slice(0, 500) || null } });
  return json({ id: e.id, date: toYmd(e.date), title: e.title, note: e.note }, 201);
}
