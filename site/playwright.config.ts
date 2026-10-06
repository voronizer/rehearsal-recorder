import { defineConfig, devices } from "@playwright/test"

// The built site in a real browser: the page, and the app in its frames on
// the fake Python side. It serves site/dist, so build first:
// npm run build && npm run test:e2e.

const PORT = 4179

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // As in ui/: a test that passes on its second go fails sometimes.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } },
    },
  ],
  webServer: {
    command: "npm run preview",
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
})
