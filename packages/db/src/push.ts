import webpush from "web-push";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";

const EXPO_URL = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;
/** Per request to a push provider; a slow provider must never hold up delivery for everyone else. */
const timeoutMs = () => Number(process.env.PUSH_TIMEOUT_MS ?? 10_000);
/** How long a delivery run may hold a notification; if the process dies, the next run takes over after this. */
const LEASE = "15 minutes";
/** A run stops starting new sends after this, so it always finishes well inside its lease (no double sends). */
const runBudgetMs = () => Number(process.env.PUSH_RUN_BUDGET_MS ?? 8 * 60_000);
const BATCH = 200;
const WEB_CONCURRENCY = 10;

type Fetch = typeof fetch;
interface Ticket { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } }

/** A browser subscription (Web Push) and the result of sending to it. */
export interface WebTarget { endpoint: string; p256dh: string; auth: string }
export interface WebMessage { id: string; title: string; body: string; urgent: boolean; url: string }
/** ok: accepted · gone: subscription is dead, remove it · error: temporary, retry later · failed: this message cannot be sent, do not retry */
export type WebResult = "ok" | "gone" | "error" | "failed";
export type WebSender = (target: WebTarget, msg: WebMessage) => Promise<WebResult>;

/**
 * Browser notifications can pop up on shared screens (e.g. the ward PC), so their text stays generic: no names, dates or
 * reasons. Details are only visible after login. (The phone app keeps the full text: it is a personal device behind a lock.)
 */
export const WEB_PUSH_BODY = "Es gibt eine neue Mitteilung. Öffne Dienstplan für Details.";

/**
 * Browsers hand out endpoints of their vendor's push service. Only those hosts are accepted, so nobody can make the server
 * send requests to arbitrary (e.g. internal) addresses. WEB_PUSH_EXTRA_HOSTS adds hosts for tests.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const extra = (process.env.WEB_PUSH_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(host)) return true;
  if (u.port && u.port !== "443") return false;
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export const vapidConfig = () => ({ subject: process.env.VAPID_SUBJECT ?? "", publicKey: process.env.VAPID_PUBLIC_KEY ?? "", privateKey: process.env.VAPID_PRIVATE_KEY ?? "" });
export const webPushConfigured = () => { const v = vapidConfig(); return !!(v.subject && v.publicKey && v.privateKey); };

/** Maps a push service's HTTP answer to what we do with the subscription. */
export function classifyPushStatus(code: number | undefined): WebResult {
  if (code === undefined) return "error"; // network error or timeout
  if (code >= 200 && code < 300) return "ok";
  if ([403, 404, 410].includes(code)) return "gone"; // subscription made with another VAPID key (e.g. after rotation), or unsubscribed
  if (code === 429 || code >= 500) return "error";
  return "failed"; // 400/401/413: our request was rejected (e.g. broken VAPID setup); keep the subscription, do not retry
}

/** Web Push sender from the VAPID settings, or null when Web Push is not configured. */
export function webPushSender(): WebSender | null {
  if (!webPushConfigured()) return null;
  const v = vapidConfig();
  return async (t, msg) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(msg), {
        TTL: 24 * 3600, urgency: msg.urgent ? "high" : "normal", timeout: timeoutMs(),
        vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
      });
      return "ok";
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      const r = classifyPushStatus(code);
      // problems on our side must be visible to operators (e.g. a mistyped VAPID key would otherwise fail silently)
      if (r === "failed" || code === undefined) console.error(`web push to ${new URL(t.endpoint).host} failed: ${code ?? ""} ${(e as Error).message}`.trim());
      return r;
    }
  };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, until = Infinity) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && Date.now() < until) await fn(items[next++]!);
  }));
}

/**
 * Sends every notification that has not been delivered yet to the owner's devices: phones via Expo (relayed to APNs/FCM),
 * browsers via Web Push. A run leases the notifications it works on (so overlapping runs never send twice, and a run that
 * dies mid-way is taken over once the lease expires). Dead subscriptions are removed; when a provider is unreachable the
 * notification is released and tried again later (up to 24 h). Never throws: the in-app notification is the source of truth.
 */
export async function deliverPendingNotifications(fetchImpl: Fetch = fetch, webSend: WebSender | null = webPushSender()): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  let claimedIds: string[] = [];
  const retry = new Set<string>();
  const delivered = new Set<string>();
  let completed = false;
  const until = Date.now() + runBudgetMs();
  try {
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification" SET "pushClaimedUntil" = (now() AT TIME ZONE 'UTC') + ${LEASE}::interval
      WHERE id IN (
        SELECT id FROM "Notification"
        WHERE "pushAttemptedAt" IS NULL AND ("pushClaimedUntil" IS NULL OR "pushClaimedUntil" < (now() AT TIME ZONE 'UTC'))
          AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours'
        ORDER BY "createdAt" LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`; // Prisma stores timestamps as UTC without a zone: compare in UTC, whatever the server's TimeZone setting
    claimedIds = claimed.map((c) => c.id);
    if (claimedIds.length === 0) return result;
    const pending = await prisma.notification.findMany({ where: { id: { in: claimedIds } }, include: { user: { include: { devices: true } } } });

    const dead = new Set<string>();

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
      if (Date.now() >= until) { chunk.forEach((m) => retry.add(m.notificationId)); continue; } // out of time: next run
      try {
        const res = await fetchImpl(EXPO_URL(), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
          body: JSON.stringify(chunk.map((m) => m.body)),
          signal: AbortSignal.timeout(timeoutMs()),
        });
        if (!res.ok) throw new Error(`Expo push responded ${res.status}`);
        const { data } = (await res.json()) as { data: Ticket[] };
        data.forEach((t, idx) => {
          const m = chunk[idx];
          if (!m) return;
          if (t.status === "ok") { result.sent++; delivered.add(m.notificationId); }
          else {
            result.failed++;
            if (t.details?.error === "DeviceNotRegistered") dead.add(m.deviceId);
          }
        });
      } catch (e) {
        result.failed += chunk.length;
        chunk.forEach((m) => retry.add(m.notificationId)); // provider unreachable or too slow: try again later
        console.error("push delivery failed", e);
      }
    }

    // browsers (Web Push), in parallel with a per-request timeout
    if (webSend) {
      const jobs = pending.flatMap((n) => !n.user.pushEnabled ? [] : n.user.devices
        .filter((d) => d.platform === "WEB" && d.p256dh && d.auth)
        .map((d) => ({ n, d })));
      const started = new Set<string>();
      await pool(jobs, WEB_CONCURRENCY, async ({ n, d }) => {
        started.add(`${n.id}|${d.id}`);
        if (!isAllowedPushEndpoint(d.token)) { dead.add(d.id); return; } // stored before the allowlist existed: never contact it
        let r: WebResult;
        try {
          r = await webSend({ endpoint: d.token, p256dh: d.p256dh!, auth: d.auth! }, { id: n.id, title: n.title, body: WEB_PUSH_BODY, urgent: n.shortNotice, url: "/benachrichtigungen" });
        } catch { r = "error"; }
        if (r === "ok") { result.sent++; delivered.add(n.id); }
        else {
          result.failed++;
          if (r === "gone") dead.add(d.id);
          else if (r === "error") retry.add(n.id);
        }
      }, until);
      for (const { n, d } of jobs) if (!started.has(`${n.id}|${d.id}`)) retry.add(n.id); // not reached before the deadline: next run
    }

    if (delivered.size) await prisma.notification.updateMany({ where: { id: { in: [...delivered] } }, data: { deliveredAt: new Date() } });
    if (dead.size) { result.removed = (await prisma.deviceToken.deleteMany({ where: { id: { in: [...dead] } } })).count; }
    completed = true;
  } catch (e) {
    console.error("push delivery error", e);
  } finally {
    // Finish the lease. Retry: temporary failures that reached no device, or everything not delivered if the run broke off.
    const again = claimedIds.filter((id) => !delivered.has(id) && (!completed || retry.has(id)));
    const done = claimedIds.filter((id) => !again.includes(id));
    try {
      if (done.length) await prisma.notification.updateMany({ where: { id: { in: done } }, data: { pushAttemptedAt: new Date(), pushClaimedUntil: null } });
      if (again.length) await prisma.notification.updateMany({ where: { id: { in: again } }, data: { pushClaimedUntil: null } });
    } catch (e) {
      console.error("push lease release failed (the lease expires on its own)", e);
    }
  }
  return result;
}

const MAX_BROWSERS_PER_USER = 10;

/** Stores (or moves to this user) a browser subscription. Keeps the 10 most recently seen browsers per person. */
export async function registerWebPush(userId: string, sub: WebTarget) {
  if (!isAllowedPushEndpoint(sub.endpoint)) throw new Error("push endpoint not allowed");
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.deviceToken.upsert({
      where: { token: sub.endpoint },
      update: { userId, platform: "WEB", p256dh: sub.p256dh, auth: sub.auth, lastSeenAt: now },
      create: { userId, platform: "WEB", token: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, lastSeenAt: now },
    });
    const browsers = await tx.deviceToken.findMany({ where: { userId, platform: "WEB" }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], select: { id: true } });
    const extra = browsers.slice(MAX_BROWSERS_PER_USER).map((b) => b.id);
    if (extra.length) await tx.deviceToken.deleteMany({ where: { id: { in: extra } } });
  });
}

export async function unregisterWebPush(userId: string, endpoint: string) {
  return (await prisma.deviceToken.deleteMany({ where: { userId, token: endpoint, platform: "WEB" } })).count;
}

/**
 * Ends all push subscriptions of a person (browsers and phones). Called whenever their sessions are ended on the server (password change or
 * reset, role/e-mail change), so a shared PC whose session just ended stops showing their notifications. A browser that is
 * still signed in re-registers itself on the next page load.
 */
export async function endBrowserPush(userId: string, tx: Pick<Prisma.TransactionClient, "deviceToken"> = prisma) {
  // all devices: a lost phone must stop getting full-text pushes once the password is changed or reset
  return (await tx.deviceToken.deleteMany({ where: { userId } })).count;
}
