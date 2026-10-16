/**
 * Runs once when the server starts (production only):
 *  - refuses to boot with an unsafe or half-done configuration instead of failing later,
 *  - retries undelivered push notifications in the background (e.g. after the push provider was unreachable).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) problems.push("SESSION_SECRET must be set and at least 32 characters (openssl rand -hex 32)");
  if (/change-?me|dev-only|secret-secret|password/i.test(secret)) problems.push("SESSION_SECRET looks like a placeholder");
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  const vapid = ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((k) => process.env[k]);
  if (vapid.length > 0 && vapid.length < 3) problems.push("Web Push needs all of VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or none of them)");
  if (process.env.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(process.env.VAPID_SUBJECT)) problems.push("VAPID_SUBJECT must start with mailto: or https://");
  if (problems.length) {
    console.error(`Invalid configuration, refusing to start:\n - ${problems.join("\n - ")}`);
    process.exit(1); // exit instead of serving errors, so the container is clearly "down" and the cause is in the log
  }

  const every = Number(process.env.PUSH_RETRY_SECONDS ?? 300);
  if (every > 0) {
    const { deliverPendingNotifications } = await import("@dienstplan/db");
    setInterval(() => { void deliverPendingNotifications(); }, every * 1000).unref();
  }
}
