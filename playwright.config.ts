import { defineConfig, devices } from "@playwright/test";

// Audit configuration. Runs its own API against DATABASE_URL, which must point
// at the disposable audit database (filspay_audit), never the dev or live one.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl.endsWith("/filspay_audit") && !databaseUrl.includes("/filspay_audit?")) {
  throw new Error("playwright: DATABASE_URL must point at the filspay_audit database");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  outputDir: "e2e-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "web",
      testMatch: /web-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5280" },
    },
    {
      name: "admin",
      testMatch: /admin-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5281" },
    },
  ],
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "apps/api",
      url: "http://127.0.0.1:3200/healthz",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "development",
        PORT: "3200",
        OTP_DEV_EXPOSE: "true",
        SETTLEMENT_INTERNAL_TOKEN: "audit-local-token",
      },
    },
    {
      command: "npx vite --config e2e/vite.web.config.ts",
      url: "http://127.0.0.1:5280/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx vite --config e2e/vite.admin.config.ts",
      url: "http://127.0.0.1:5281/",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
