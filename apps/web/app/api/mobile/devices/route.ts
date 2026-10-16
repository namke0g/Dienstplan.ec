import { prisma } from "@dienstplan/db";
import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[^\]]+\]$/;

/** Register (or move to this user) an Expo push token. A device that logs in as someone else stops receiving the previous user's pushes. */
export async function POST(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { token?: string; platform?: string };
  const platform = b.platform === "ios" ? "IOS" : b.platform === "android" ? "ANDROID" : null;
  if (!b.token || !EXPO_TOKEN.test(b.token) || !platform) return json({ error: "invalid" }, 400);
  await prisma.deviceToken.upsert({ where: { token: b.token }, update: { userId: me.id, platform }, create: { userId: me.id, platform, token: b.token } });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await mobileUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { token?: string };
  const { count } = await prisma.deviceToken.deleteMany({ where: { token: String(b.token ?? ""), userId: me.id } });
  return json({ deleted: count });
}
