import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/a11y-pages",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // The app talks to api.research-center.fit in production. In CI
    // there is no backend, so unset the absolute URLs in api-client.ts
    // by routing to about:blank. The axe scan only needs the SPA's
    // render tree to be intact.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});