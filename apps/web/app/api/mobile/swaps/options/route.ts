import { prisma, previewSwap, upcomingShifts } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

/** For the create flow: colleagues, and (with `with=`) their upcoming shifts with a rule check for each option. */
export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  const withId = url.searchParams.get("with");
  const colleagues = await prisma.user.findMany({ where: { wardId: me.wardId, role: "EMPLOYEE", active: true, id: { not: me.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  if (!withId || !colleagues.some((c) => c.id === withId)) return json({ colleagues });
  const theirs = await upcomingShifts(withId, 60);
  return json({
    colleagues,
    handOverProblems: await previewSwap(me.id, { date, partnerId: withId }),
    theirs: await Promise.all(theirs.map(async (s) => ({ date: s.date, type: { id: s.type.id, name: s.type.name, startMin: s.type.startMin, endMin: s.type.endMin }, problems: await previewSwap(me.id, { date, partnerId: withId, partnerDate: s.date }) }))),
  });
}
