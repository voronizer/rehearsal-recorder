import { defineConfig } from "drizzle-kit"

// The tables are described once, in worker/shared/schema.ts; `npx drizzle-kit
// generate` writes the next migration from what changed there.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/shared/schema.ts",
  out: "./migrations",
})
