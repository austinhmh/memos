import { defineConfig, devices } from "@playwright/test";

const appBaseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8081";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: appBaseURL,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "app-chromium",
      testMatch: /.*\.app\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
