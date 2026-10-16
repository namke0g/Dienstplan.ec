import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchPending, webPushSender } from "@dienstplan/db";

export const dynamic = "force-dynamic";

/** Retry endpoint for a cron job: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" <url>/api/push/dispatch` */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new NextResponse(null, { status: 401 });
  const send = webPushSender();
  if (!send) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 });
  return NextResponse.json(await dispatchPending(send));
}
