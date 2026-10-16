import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromium = "/opt/pw-browsers/chromium";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", launchOptions: existsSync(chromium) ? { executablePath: chromium } : {} },
  webServer: { command: "pnpm exec next start -p 3100", url: "http://localhost:3100/login", reuseExistingServer: false, env: { SESSION_SECRET: "e2e-test-secret-e2e-test-secret-1234" }, timeout: 60_000 },
});
