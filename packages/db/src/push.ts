import webpush from "web-push";
import { prisma } from "./client";

export interface PushTarget { id: string; platform: "IOS" | "ANDROID" | "WEB"; token: string; p256dh: string | null; auth: string | null }
export interface PushMessage { title: string; body: string; urgent: boolean; url: string }
export type PushResult = "ok" | "gone" | "error";
/** One delivery channel. Web Push today; an Expo sender for the phone app plugs into the same shape. */
export type PushSender = (target: PushTarget, msg: PushMessage) => Promise<PushResult>;

/** Lock-screen text stays generic on purpose: no shift times, no leave reasons. Details are behind login. */
export const GENERIC_BODY = "Es gibt eine neue Mitteilung. Öffne Dienstplan für Details.";

export function toMessage(n: { title: string; shortNotice: boolean }): PushMessage {
  return { title: n.title, body: GENERIC_BODY, urgent: n.shortNotice, url: "/benachrichtigungen" };
}

export function webPushSender(vapid = { subject: process.env.VAPID_SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }): PushSender | null {
  if (!vapid.subject || !vapid.publicKey || !vapid.privateKey) return null;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (t, msg) => {
    if (t.platform !== "WEB" || !t.p256dh || !t.auth) return "error";
    try {
      await webpush.sendNotification(
        { endpoint: t.token, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(msg),
        { TTL: 60 * 60 * 24, urgency: msg.urgent ? "high" : "normal" },
      );
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      return code === 404 || code === 410 ? "gone" : "error";
    }
  };
}

/**
 * Send all not-yet-delivered notifications to the owner's devices.
 * A notification counts as delivered once at least one device accepted it; users without any device keep it in-app only
 * (marked delivered too, so they are not retried forever). Dead subscriptions are removed. Safe to call repeatedly.
 */
export async function dispatchPending(send: PushSender, limit = 200) {
  const pending = await prisma.notification.findMany({
    where: { deliveredAt: null }, orderBy: { createdAt: "asc" }, take: limit,
    include: { user: { select: { devices: true } } },
  });
  let sent = 0, failed = 0;
  for (const n of pending) {
    const devices = n.user.devices;
    let anyOk = false, anyError = false;
    for (const d of devices) {
      const r = await send(d, toMessage(n));
      if (r === "ok") { anyOk = true; sent++; }
      else if (r === "gone") await prisma.deviceToken.deleteMany({ where: { id: d.id } });
      else { anyError = true; failed++; }
    }
    // retry later only if every attempt failed transiently; otherwise we are done with this notification
    if (devices.length > 0 && !anyOk && anyError) continue;
    await prisma.notification.update({ where: { id: n.id }, data: { deliveredAt: new Date() } });
  }
  return { processed: pending.length, sent, failed };
}

export async function registerWebPush(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
  await prisma.deviceToken.upsert({
    where: { token: sub.endpoint },
    update: { userId, p256dh: sub.p256dh, auth: sub.auth },
    create: { userId, platform: "WEB", token: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
  });
}

export async function unregisterDevice(userId: string, token: string) {
  await prisma.deviceToken.deleteMany({ where: { userId, token } });
}

/** Create an in-app notification (picked up by dispatchPending). The leave workflow calls this for approved/rejected decisions. */
export async function notifyUser(userId: string, n: { type: string; title: string; body: string; shortNotice?: boolean }) {
  return prisma.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, shortNotice: n.shortNotice ?? false } });
}
