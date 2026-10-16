/** Runs once when the server starts: refuse to boot in production with an unsafe configuration instead of failing on the first login. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) problems.push("SESSION_SECRET must be set and at least 32 characters (openssl rand -hex 32)");
  if (/change-?me|dev-only|secret-secret|password/i.test(secret)) problems.push("SESSION_SECRET looks like a placeholder");
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  if (problems.length) {
    console.error(`Invalid configuration, refusing to start:\n - ${problems.join("\n - ")}`);
    process.exit(1); // exit instead of serving errors, so the container is clearly "down" and the cause is in the log
  }
}
