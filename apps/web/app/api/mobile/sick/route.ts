import { createSickReport, ForbiddenError, sickReportsFor, SickError } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";
import { deliverSoon } from "@/lib/deliver";

export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  return json({ reports: await sickReportsFor(me.id) });
}

/** The signed-in employee reports sick (the app has no "on behalf" flow; planners use the web). */
export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { start?: string; end?: string; note?: string };
  try {
    const r = await createSickReport(me.id, { start: String(b.start ?? ""), end: String(b.end ?? b.start ?? ""), note: b.note });
    deliverSoon();
    return json({ id: r.report.id }, 201);
  } catch (e) {
    if (e instanceof SickError || e instanceof ForbiddenError) return json({ error: e.message }, 400);
    throw e;
  }
}
