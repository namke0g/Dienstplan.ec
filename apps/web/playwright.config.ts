import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { createECDH } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Self-signed certificate for the fake Web Push service in e2e/webpush.spec.ts. Created once by the runner; workers inherit the path.
if (!process.env.PUSH_TEST_CERT_DIR) {
  const dir = mkdtempSync(join(tmpdir(), "push-cert-"));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost`, { stdio: "ignore" });
  process.env.PUSH_TEST_CERT_DIR = dir;
}

// fresh VAPID key pair per test run (P-256, base64url) - nothing secret is committed
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const vapid = { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") };

const LOCAL_CHROMIUM = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  // one retry in CI: a test that only passes on retry is reported as "flaky" (annotation), not silently ignored
  retries: process.env.CI ? 1 : 0,
  // in CI, failed tests become annotations with the error message (readable without downloading logs)
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  // full Chromium in headless mode, everywhere: Playwright's slimmed-down "headless shell" always reports notifications as
  // blocked, so browser-push behaviour could not be tested with it (and it differs from what people actually use)
  // (a preinstalled full Chromium is used by path where one exists, e.g. in cloud dev containers)
  use: { baseURL: "http://localhost:3100", ...(existsSync(LOCAL_CHROMIUM) ? { launchOptions: { executablePath: LOCAL_CHROMIUM } } : { channel: "chromium" }) },
  // Runs the same standalone server the Docker image runs (production mode), so the e2e suite also covers the build artifact,
  // including the bundled Prisma engine. Requires `next build` first.
  webServer: {
    command: "sh -c 'mkdir -p .next/standalone/apps/web/.next && rm -rf .next/standalone/apps/web/.next/static .next/standalone/apps/web/public && cp -r .next/static .next/standalone/apps/web/.next/static && cp -r public .next/standalone/apps/web/public && cd .next/standalone/apps/web && node server.js'",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: "3100",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      SESSION_SECRET: "e2e0123456789abcdef0123456789abcdef01234",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://dienstplan:dienstplan@localhost:5432/dienstplan",
      EXPO_PUSH_URL: "http://localhost:3199/push",
      VAPID_SUBJECT: "mailto:e2e@example.com",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      PUSH_RETRY_SECONDS: "0", // no background timer in tests; deliveries happen right after each action
      NODE_EXTRA_CA_CERTS: join(process.env.PUSH_TEST_CERT_DIR!, "c.pem"), // trust exactly the test certificate; TLS verification stays on
    },
  },
});
