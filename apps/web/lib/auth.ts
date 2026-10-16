import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma, type Role } from "@dienstplan/db";

const COOKIE = "session";
export const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return new TextEncoder().encode(s || "dev-only-insecure-secret-change-me");
};

export async function createSession(userId: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience("web").setExpirationTime("30d").sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "web" });
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } });
    return user?.active ? user : null;
  } catch {
    return null;
  }
}

export async function requireUser(roles?: Role[]) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/");
  return user;
}

export const homeFor = (role: Role) => (role === "PLANNER" || role === "ADMIN" ? "/planer" : role === "PDL" || role === "BETRIEBSRAT" ? "/pruefung" : "/mein-plan");
