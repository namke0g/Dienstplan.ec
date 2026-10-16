import { NextResponse } from "next/server";
import { registerWebPush, unregisterDevice } from "@dienstplan/db";
import { getUser } from "@/lib/auth";

export async function POST(req: Request) {
  const me = await getUser();
  if (!me) return new NextResponse(null, { status: 401 });
  const b = await req.json().catch(() => null) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!b?.endpoint?.startsWith("https://") || !b.keys?.p256dh || !b.keys.auth) return new NextResponse(null, { status: 400 });
  await registerWebPush(me.id, { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: Request) {
  const me = await getUser();
  if (!me) return new NextResponse(null, { status: 401 });
  const b = await req.json().catch(() => null) as { endpoint?: string } | null;
  if (!b?.endpoint) return new NextResponse(null, { status: 400 });
  await unregisterDevice(me.id, b.endpoint);
  return new NextResponse(null, { status: 204 });
}
