import { isAllowedPushEndpoint, registerWebPush, unregisterWebPush, webPushConfigured } from "@dienstplan/db";
import { getUser } from "@/lib/auth";

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const valid = (b: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null) =>
  !!b && typeof b.endpoint === "string" && b.endpoint.length <= 2048 && isAllowedPushEndpoint(b.endpoint) && // only real push services
  typeof b.keys?.p256dh === "string" && B64URL.test(b.keys.p256dh) && b.keys.p256dh.length <= 200 &&
  typeof b.keys?.auth === "string" && B64URL.test(b.keys.auth) && b.keys.auth.length <= 100;

/** Saves this browser's push subscription for the signed-in person (sent by the browser after the user allowed notifications). */
export async function POST(req: Request) {
  const me = await getUser();
  if (!me) return new Response(null, { status: 401 });
  if (!webPushConfigured()) return Response.json({ error: "web_push_not_configured" }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!valid(b)) return Response.json({ error: "invalid_subscription" }, { status: 400 });
  await registerWebPush(me.id, { endpoint: b!.endpoint!, p256dh: b!.keys!.p256dh!, auth: b!.keys!.auth! });
  return new Response(null, { status: 204 });
}

/** Removes this browser's subscription (switching push off here, or logging out on a shared computer). */
export async function DELETE(req: Request) {
  const me = await getUser();
  if (!me) return new Response(null, { status: 401 });
  const b = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!b?.endpoint) return Response.json({ error: "invalid_subscription" }, { status: 400 });
  await unregisterWebPush(me.id, b.endpoint);
  return new Response(null, { status: 204 });
}
