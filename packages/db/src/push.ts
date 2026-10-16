import { prisma } from "./client";

const EXPO_URL = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

type Fetch = typeof fetch;
interface Ticket { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } }

/**
 * Sends every notification that has not been attempted yet to the user's registered devices via Expo
 * (which relays to APNs for iOS and FCM for Android). Tokens Expo reports as unregistered are removed.
 * Never throws: push is best-effort, the in-app notification is the source of truth.
 */
export async function deliverPendingNotifications(fetchImpl: Fetch = fetch): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  try {
    const pending = await prisma.notification.findMany({
      where: { pushAttemptedAt: null, createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) } },
      include: { user: { include: { devices: true } } },
      take: 500,
    });
    if (pending.length === 0) return result;

    const messages = pending.flatMap((n) =>
      !n.user.pushEnabled ? [] : n.user.devices.filter((d) => d.platform !== "WEB").map((d) => ({
        notificationId: n.id, deviceId: d.id, token: d.token,
        body: {
          to: d.token, title: n.title, body: n.body, sound: "default", priority: n.shortNotice ? "high" : "normal",
          channelId: n.shortNotice ? "urgent" : "default", data: { type: n.type, notificationId: n.id },
        },
      })),
    );
    await prisma.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { pushAttemptedAt: new Date() } });

    const delivered = new Set<string>();
    const dead: string[] = [];
    const retry = new Set<string>();
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
    const toRetry = [...retry].filter((id) => !delivered.has(id));
    if (toRetry.length) await prisma.notification.updateMany({ where: { id: { in: toRetry } }, data: { pushAttemptedAt: null } });
    if (delivered.size) await prisma.notification.updateMany({ where: { id: { in: [...delivered] } }, data: { deliveredAt: new Date() } });
    if (dead.length) { result.removed = (await prisma.deviceToken.deleteMany({ where: { id: { in: dead } } })).count; }
  } catch (e) {
    console.error("push delivery error", e);
  }
  return result;
}
