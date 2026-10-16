import webpush from "web-push";
import { prisma } from "./client";

const EXPO_URL = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

type Fetch = typeof fetch;
interface Ticket { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } }

/** A browser subscription (Web Push) and the result of sending to it. */
export interface WebTarget { endpoint: string; p256dh: string; auth: string }
export interface WebMessage { title: string; body: string; urgent: boolean; url: string }
export type WebResult = "ok" | "gone" | "error";
export type WebSender = (target: WebTarget, msg: WebMessage) => Promise<WebResult>;

/**
 * Browser notifications can pop up on shared screens (e.g. the ward PC), so their text stays generic: no names, dates or
 * reasons. Details are only visible after login. (The phone app keeps the full text: it is a personal device behind a lock.)
 */
export const WEB_PUSH_BODY = "Es gibt eine neue Mitteilung. Öffne Dienstplan für Details.";

export const vapidConfig = () => ({ subject: process.env.VAPID_SUBJECT ?? "", publicKey: process.env.VAPID_PUBLIC_KEY ?? "", privateKey: process.env.VAPID_PRIVATE_KEY ?? "" });
export const webPushConfigured = () => { const v = vapidConfig(); return !!(v.subject && v.publicKey && v.privateKey); };

/** Web Push sender from the VAPID settings, or null when Web Push is not configured. */
export function webPushSender(): WebSender | null {
  if (!webPushConfigured()) return null;
  const v = vapidConfig();
  return async (t, msg) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(msg), {
        TTL: 24 * 3600, urgency: msg.urgent ? "high" : "normal", vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
      });
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      return code === 404 || code === 410 ? "gone" : "error"; // 404/410: the browser dropped the subscription
    }
  };
}

/**
 * Sends every notification that has not been attempted yet to the owner's devices: phones via Expo (relayed to APNs/FCM),
 * browsers via Web Push. Notifications are claimed atomically, so overlapping runs (an action and the retry timer) never send
 * the same message twice. Subscriptions the provider reports as gone are removed; when a provider is unreachable the
 * notification is released and tried again on the next run. Never throws: the in-app notification is the source of truth.
 */
export async function deliverPendingNotifications(fetchImpl: Fetch = fetch, webSend: WebSender | null = webPushSender()): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  try {
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification" SET "pushAttemptedAt" = now()
      WHERE id IN (
        SELECT id FROM "Notification"
        WHERE "pushAttemptedAt" IS NULL AND "createdAt" > now() - interval '24 hours'
        ORDER BY "createdAt" LIMIT 500
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (claimed.length === 0) return result;
    const pending = await prisma.notification.findMany({ where: { id: { in: claimed.map((c) => c.id) } }, include: { user: { include: { devices: true } } } });

    const delivered = new Set<string>();
    const dead: string[] = [];
    const retry = new Set<string>();

    // phones (Expo)
    const messages = pending.flatMap((n) =>
      !n.user.pushEnabled ? [] : n.user.devices.filter((d) => d.platform !== "WEB").map((d) => ({
        notificationId: n.id, deviceId: d.id,
        body: {
          to: d.token, title: n.title, body: n.body, sound: "default", priority: n.shortNotice ? "high" : "normal",
          channelId: n.shortNotice ? "urgent" : "default", data: { type: n.type, notificationId: n.id },
        },
      })),
    );
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      try {
        const res = await fetchImpl(EXPO_URL(), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
          body: JSON.stringify(chunk.map((m) => m.body)),
        });
        if (!res.ok) throw new Error(`Expo push responded ${res.status}`);
        const { data } = (await res.json()) as { data: Ticket[] };
        data.forEach((t, idx) => {
          const m = chunk[idx];
          if (!m) return;
          if (t.status === "ok") { result.sent++; delivered.add(m.notificationId); }
          else {
            result.failed++;
            if (t.details?.error === "DeviceNotRegistered") dead.push(m.deviceId);
          }
        });
      } catch (e) {
        result.failed += chunk.length;
        chunk.forEach((m) => retry.add(m.notificationId)); // provider unreachable: try again on the next run
        console.error("push delivery failed", e);
      }
    }

    // browsers (Web Push)
    if (webSend) {
      for (const n of pending) {
        if (!n.user.pushEnabled) continue;
        for (const d of n.user.devices) {
          if (d.platform !== "WEB" || !d.p256dh || !d.auth) continue;
          const r = await webSend({ endpoint: d.token, p256dh: d.p256dh, auth: d.auth }, { title: n.title, body: WEB_PUSH_BODY, urgent: n.shortNotice, url: "/benachrichtigungen" });
          if (r === "ok") { result.sent++; delivered.add(n.id); }
          else if (r === "gone") { result.failed++; dead.push(d.id); }
          else { result.failed++; retry.add(n.id); }
        }
      }
    }

    const toRetry = [...retry].filter((id) => !delivered.has(id));
    if (toRetry.length) await prisma.notification.updateMany({ where: { id: { in: toRetry } }, data: { pushAttemptedAt: null } });
    if (delivered.size) await prisma.notification.updateMany({ where: { id: { in: [...delivered] } }, data: { deliveredAt: new Date() } });
    if (dead.length) { result.removed = (await prisma.deviceToken.deleteMany({ where: { id: { in: dead } } })).count; }
  } catch (e) {
    console.error("push delivery error", e);
  }
  return result;
}

const MAX_BROWSERS_PER_USER = 10;

/** Stores (or moves to this user) a browser subscription. Keeps at most 10 browsers per person, dropping the oldest. */
export async function registerWebPush(userId: string, sub: WebTarget) {
  await prisma.$transaction(async (tx) => {
    await tx.deviceToken.upsert({
      where: { token: sub.endpoint },
      update: { userId, platform: "WEB", p256dh: sub.p256dh, auth: sub.auth },
      create: { userId, platform: "WEB", token: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    });
    const browsers = await tx.deviceToken.findMany({ where: { userId, platform: "WEB" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const extra = browsers.slice(MAX_BROWSERS_PER_USER).map((b) => b.id);
    if (extra.length) await tx.deviceToken.deleteMany({ where: { id: { in: extra } } });
  });
}

export async function unregisterWebPush(userId: string, endpoint: string) {
  return (await prisma.deviceToken.deleteMany({ where: { userId, token: endpoint, platform: "WEB" } })).count;
}
