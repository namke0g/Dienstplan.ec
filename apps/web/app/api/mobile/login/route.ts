import bcrypt from "bcryptjs";
import { prisma } from "@dienstplan/db";
import { json } from "@/lib/mobileAuth";
import { signMobileToken } from "@/lib/mobileAuth";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const user = await prisma.user.findUnique({ where: { email: String(email ?? "").trim().toLowerCase() } });
  const ok = await bcrypt.compare(String(password ?? ""), user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !user.active || !ok) return json({ error: "invalid_credentials" }, 401);
  return json({ token: await signMobileToken(user.id), user: { id: user.id, name: user.name, role: user.role, pushEnabled: user.pushEnabled } });
}
