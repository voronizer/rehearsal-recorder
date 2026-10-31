import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

// The pictures on reha.stream/band-service (pictures/site.spec.ts), taken of
// the real Worker over a band of their own (pictures/seed.ts). Not a test:
// `npm run pictures` runs it by hand.
export default defineConfig({
  ...base,
  testDir: "./pictures",
  globalSetup: "./pictures/seed.ts",
  timeout: 60_000,
  projects: [{ name: "chromium" }],
})
