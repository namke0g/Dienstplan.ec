import bcrypt from "bcryptjs";
import { prisma } from "@dienstplan/db";
import { json } from "@/lib/mobileAuth";
import { dummyHash } from "@/lib/dummyHash";
import { beginLoginAttempt, clientIp, recordLoginSuccess } from "@/lib/rateLimit";
import { signMobileToken } from "@/lib/mobileAuth";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const mail = String(email ?? "").trim().toLowerCase();
  const ip = clientIp(req.headers);
  const wait = beginLoginAttempt(ip, mail);
  if (wait !== null) return Response.json({ error: "too_many_attempts", retryAfterSeconds: wait }, { status: 429, headers: { "retry-after": String(wait), "cache-control": "no-store" } });
  const user = await prisma.user.findUnique({ where: { email: mail } });
  const ok = await bcrypt.compare(String(password ?? ""), user?.passwordHash ?? dummyHash());
  if (!user || !user.active || !ok) return json({ error: "invalid_credentials" }, 401);
  recordLoginSuccess(ip, mail);
  return json({ token: await signMobileToken(user.id), user: { id: user.id, name: user.name, role: user.role, pushEnabled: user.pushEnabled } });
}
