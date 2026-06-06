import { defineConfig, devices } from "@playwright/test";

const editorBaseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: editorBaseURL,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173",
    url: `${editorBaseURL}/__e2e__/blog-editor-table`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "editor-chromium",
      testMatch: /.*\.editor\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
