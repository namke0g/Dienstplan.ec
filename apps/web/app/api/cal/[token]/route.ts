import { prisma, toDate, type SnapshotShift } from "@dienstplan/db";
import { buildIcs } from "@dienstplan/core";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cal = await prisma.calendarToken.findUnique({ where: { secret: token }, include: { user: true } });
  if (!cal || !cal.user.active) return new Response("Not found", { status: 404 });

  const from = new Date(); from.setUTCDate(1); from.setUTCMonth(from.getUTCMonth() - 2);
  const plans = await prisma.plan.findMany({
    where: { wardId: cal.user.wardId, month: { gte: toDate(from.toISOString().slice(0, 10)) } },
  });
  const types = new Map((await prisma.shiftType.findMany({ where: { wardId: cal.user.wardId } })).map((t) => [t.id, t]));
  const shifts = plans.filter((p) => p.publishedSnapshot != null).flatMap((p) => ((p.publishedSnapshot ?? []) as unknown as SnapshotShift[]).filter((s) => s.userId === cal.userId));

  const ics = buildIcs(
    shifts.flatMap((s) => {
      const t = types.get(s.shiftTypeId);
      // sick days go to third-party calendars as "Abwesend": health data does not belong in Google/iCloud
      return t ? [{ id: s.id, date: s.date, sequence: s.sequence, type: { id: t.id, name: t.kind === "SICK" ? "Abwesend" : t.name, startMin: t.startMin, endMin: t.endMin, kind: t.kind } }] : [];
    }),
    { calName: "Dienstplan" },
  );
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" } });
}
