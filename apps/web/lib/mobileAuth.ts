import { SignJWT, jwtVerify } from "jose";
import { prisma, sessionStillValid, tokenIssuedAt } from "@dienstplan/db";
import { secret } from "@/lib/auth";

export async function signMobileToken(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { sessionsValidAfter: true } });
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience("mobile").setIssuedAt(tokenIssuedAt(u?.sessionsValidAfter ?? null)).setExpirationTime("90d").sign(secret());
}

export async function mobileUser(req: Request) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(h.slice(7), secret(), { audience: "mobile" });
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } });
    return user?.active && sessionStillValid(user.sessionsValidAfter, payload.iat) ? user : null;
  } catch {
    return null;
  }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const unauthorized = () => json({ error: "unauthorized" }, 401);
