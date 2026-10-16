import { prisma, daysInMonth, toDate, toYmd } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";
import { ABSENT_TYPE, canSeeSick, maskSick, planFor, snapshotOf, wardContext } from "@/lib/roster";
import { monthParam } from "@/lib/format";

/** Published plan for a month (what staff may see), with sick leave masked for colleagues. */
export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const month = monthParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const days = daysInMonth(`${month}-01`);
  const { staff, types } = await wardContext(me.wardId, [month]);
  const plan = await planFor(me.wardId, month);
  const published = plan?.publishedSnapshot != null;
  const see = canSeeSick(me.role);
  const shifts = maskSick(snapshotOf(plan), types, me.id, see);
  const entries = await prisma.personalEntry.findMany({
    where: { userId: me.id, date: { gte: toDate(days[0]!), lte: toDate(days[days.length - 1]!) } }, orderBy: { date: "asc" },
  });
  return json({
    month, published,
    publishedAt: plan?.publishedAt ?? null,
    version: plan?.publishedVersion ?? null,
    pendingChange: !!plan && published && plan.version !== plan.publishedVersion,
    types: [...types.filter((t) => see || t.kind !== "SICK"), ...(see ? [] : [ABSENT_TYPE])].map((t) => ({
      id: t.id, code: t.code, name: t.name, color: t.color, kind: t.kind, paid: t.paid,
      startMin: "startMin" in t ? t.startMin : 0, endMin: "endMin" in t ? t.endMin : 0,
    })),
    staff, shifts: shifts.map((s) => ({ userId: s.userId, date: s.date, shiftTypeId: s.shiftTypeId })),
    entries: entries.map((e) => ({ id: e.id, date: toYmd(e.date), title: e.title, note: e.note })),
  });
}
