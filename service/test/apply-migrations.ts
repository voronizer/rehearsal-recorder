import { applyD1Migrations, reset } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { afterEach, beforeEach, vi } from "vitest"
import { call } from "./helpers"

// Each test starts with empty tables, an empty bucket and empty stand-ins.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await call("/api/stand-ins", { method: "DELETE" })
})

afterEach(() => {
  vi.useRealTimers()
})
