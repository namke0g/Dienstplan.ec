import { canTake, createSwap, swapBoard, SwapError, upcomingShifts } from "@dienstplan/db";
import { deliverSoon } from "@/lib/deliver";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";
import { swapDto } from "@/lib/swapDto";

export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  if (me.role !== "EMPLOYEE") return json({ error: "employees_only" }, 403);
  const [board, shifts] = await Promise.all([swapBoard(me.id), upcomingShifts(me.id, 60)]);
  return json({
    mine: board.mine.map(swapDto), forMe: board.forMe.map(swapDto),
    open: await Promise.all(board.open.map(async (r) => ({ ...swapDto(r), problems: await canTake(r.id, me.id) }))),
    shifts: shifts.map((s) => ({ date: s.date, type: { id: s.type.id, name: s.type.name, startMin: s.type.startMin, endMin: s.type.endMin } })),
  });
}

export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { date?: string; partnerId?: string; partnerDate?: string; note?: string };
  try {
    const r = await createSwap(me.id, { date: String(b.date ?? ""), partnerId: b.partnerId, partnerDate: b.partnerDate, note: b.note });
    deliverSoon();
    return json({ id: r.id, status: r.status }, 201);
  } catch (e) {
    if (e instanceof SwapError) return json({ error: e.message }, 400);
    throw e;
  }
}
