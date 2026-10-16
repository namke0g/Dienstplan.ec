import { prisma, createLeave, deliverPendingNotifications, LeaveError, toYmd } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

const dto = (r: { id: string; status: string; start: Date; end: Date; note: string | null; decisionComment: string | null; shiftType: { id: string; name: string; paid: boolean } }) => ({
  id: r.id, status: r.status, start: toYmd(r.start), end: toYmd(r.end), note: r.note, decisionComment: r.decisionComment,
  type: { id: r.shiftType.id, name: r.shiftType.name, paid: r.shiftType.paid },
});

export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const [types, requests] = await Promise.all([
    prisma.shiftType.findMany({ where: { wardId: me.wardId, kind: { in: ["VACATION", "SPECIAL_LEAVE"] } }, orderBy: { name: "asc" } }),
    prisma.leaveRequest.findMany({ where: { userId: me.id }, orderBy: { start: "desc" }, take: 50, include: { shiftType: true } }),
  ]);
  return json({
    types: types.map((t) => ({ id: t.id, name: t.name, paid: t.paid, noteRequired: t.kind === "SPECIAL_LEAVE" })),
    requests: requests.map(dto),
  });
}

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { typeId?: string; start?: string; end?: string; note?: string };
  try {
    const r = await createLeave(me.id, { shiftTypeId: String(b.typeId ?? ""), start: String(b.start ?? ""), end: String(b.end ?? b.start ?? ""), note: b.note });
    await deliverPendingNotifications();
    const full = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id }, include: { shiftType: true } });
    return json(dto(full), 201);
  } catch (e) {
    if (e instanceof LeaveError) return json({ error: e.message }, 400);
    throw e;
  }
}
