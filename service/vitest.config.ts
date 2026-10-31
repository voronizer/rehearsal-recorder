import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// The Worker's tests run inside the Workers runtime, on the `test`
// environment of wrangler.jsonc, with every migration applied to a fresh
// database before each file (test/apply-migrations.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations")
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  }
})
