import { localToday } from "@dienstplan/core";
import { ForbiddenError, getPreference, myWishes, prisma, setWish, WishError } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";
import { shiftMonth } from "@/lib/format";

const nextMonth = () => shiftMonth(localToday().slice(0, 7), 1);

/** `?m=YYYY-MM` (default: next month): own wishes, whether the month is open, standing preferences and the work shifts to choose from. */
export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const m = new URL(req.url).searchParams.get("m");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : nextMonth();
  const [mine, preference, shifts] = await Promise.all([
    myWishes(me.id, month), getPreference(me.id),
    prisma.shiftType.findMany({ where: { wardId: me.wardId, kind: "WORK" }, orderBy: { startMin: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return json({ ...mine, preference, shifts });
}

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { date?: string; kind?: string; shiftTypeId?: string; note?: string };
  try {
    const w = await setWish(me.id, { date: String(b.date ?? ""), kind: b.kind === "SHIFT" ? "SHIFT" : "FREE", shiftTypeId: b.shiftTypeId ?? null, note: b.note });
    return json({ id: w.id }, 201);
  } catch (e) {
    if (e instanceof WishError || e instanceof ForbiddenError) return json({ error: e.message }, 400);
    throw e;
  }
}
