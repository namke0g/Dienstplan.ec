import { SignJWT, jwtVerify } from "jose";
import { prisma, sessionStillValid } from "@dienstplan/db";
import { secret } from "@/lib/auth";

export const signMobileToken = (userId: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience("mobile").setIssuedAt().setExpirationTime("90d").sign(secret());

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
