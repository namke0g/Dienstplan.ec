import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function GET(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const tok = await prisma.calendarToken.findUnique({ where: { userId: me.id } });
  if (!tok) return json({ error: "none" }, 404);
  const host = new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return json({ https: `${proto}://${host}/api/cal/${tok.secret}`, webcal: `webcal://${host}/api/cal/${tok.secret}` });
}
