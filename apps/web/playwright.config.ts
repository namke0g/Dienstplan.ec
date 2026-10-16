import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromium = "/opt/pw-browsers/chromium";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", launchOptions: existsSync(chromium) ? { executablePath: chromium } : {} },
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
    },
  },
});
