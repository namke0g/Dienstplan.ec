import { prisma } from "@dienstplan/db";

export const dynamic = "force-dynamic";

/** Liveness + database check for the container health check and uptime monitoring. Reveals nothing about the system. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
