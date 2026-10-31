import { defineConfig, devices } from "@playwright/test"

// The pages in a real browser against the real Worker, run on this computer
// with the stand-ins of the `test` environment and a made-up band in a fresh
// database (e2e/seed.ts). `npm run e2e:serve` builds the pages and the
// Worker, makes the database and starts the Worker; the tests run one at a
// time, since they share that one band.

const PORT = 8799

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/seed.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  // As in ui/: a test that passes on its second go fails sometimes.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 } },
    },
  ],
  webServer: {
    command: "npm run e2e:serve",
    url: `http://localhost:${PORT}/api/openapi.json`,
    // The seed needs a fresh database, so the Worker is started anew each time.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
