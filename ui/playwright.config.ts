import { defineConfig, devices } from "@playwright/test"

// The interface in a real browser, against the faked Python side in
// e2e/fake-bridge.js. For what needs a page laid out and a mouse: the
// recording screen's tiles, the timeline, the keys. What can be checked
// without a browser is in the Vitest files beside the code.
//
// It drives ui/dist, so build first: npm run build && npm run test:e2e.

const PORT = 4178

export default defineConfig({
  testDir: "./e2e",
  // Each test sets up the state it needs, so they run side by side — four at
  // a time. Eight browsers at once on an eight-core laptop starved each
  // other, and a player test that takes a few seconds on its own ran past
  // its time; CI's Linux runner has four cores.
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // A test that passes on its second go is a test that fails sometimes; that
  // is worth seeing, not hiding.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 } },
    },
  ],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
})
